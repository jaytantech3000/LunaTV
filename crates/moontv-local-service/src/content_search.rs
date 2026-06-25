use std::convert::Infallible;

use anyhow::Result;
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderValue, header::CACHE_CONTROL},
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
};
use futures::{
    StreamExt,
    future::join_all,
    stream::{self, FuturesUnordered},
};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tracing::warn;

use crate::{
    ApiSite, AppError, AppResult, AppState, ContentSuggestion, DEFAULT_SEARCH_TIMEOUT_MS,
    DEFAULT_WEB_UA, SearchQueryParams, SearchResponse, SearchResult, ServiceConfig,
    SuggestionsResponse, apply_query_cache_headers, build_collection_api_url,
    build_downstream_headers, clean_html_tags, extract_episodes_from_play_url,
    filter_adult_content_results, normalize_year, parse_usize, value_to_i64, value_to_string,
};

pub(crate) async fn get_content_search(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut results = if query.is_empty() {
        Vec::new()
    } else {
        search_all_sites(&state.client, &config, &query).await
    };

    if config.adult_content_filter_enabled {
        results = filter_adult_content_results(results);
    }

    let mut response = Json(SearchResponse { results }).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

pub(crate) async fn stream_content_search(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return Err(AppError::bad_request("搜索关键词不能为空"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let api_sites = config
        .api_sites
        .iter()
        .filter(|site| !site.disabled)
        .cloned()
        .collect::<Vec<_>>();
    let total_sources = api_sites.len();
    let max_search_pages = config.max_search_pages;
    let adult_content_filter_enabled = config.adult_content_filter_enabled;
    let client = state.client.clone();
    let (tx, rx) =
        mpsc::channel::<Result<Event, Infallible>>(total_sources.saturating_mul(2).max(8));

    tokio::spawn(async move {
        if tx
            .send(Ok(Event::default().data(
                json!({
                    "type": "start",
                    "query": query.clone(),
                    "totalSources": total_sources,
                })
                .to_string(),
            )))
            .await
            .is_err()
        {
            return;
        }

        if total_sources == 0 {
            let _ = tx
                .send(Ok(Event::default().data(
                    json!({
                        "type": "complete",
                        "completedSources": 0,
                        "totalResults": 0,
                    })
                    .to_string(),
                )))
                .await;
            return;
        }

        let mut tasks = FuturesUnordered::new();
        for api_site in api_sites {
            let client = client.clone();
            let query = query.clone();

            tasks.push(async move {
                match search_site(&client, &api_site, &query, max_search_pages).await {
                    Ok(results) => {
                        let results = if adult_content_filter_enabled {
                            filter_adult_content_results(results)
                        } else {
                            results
                        };
                        Ok((api_site, results))
                    }
                    Err(error) => Err((api_site, error.to_string())),
                }
            });
        }

        let mut completed_sources = 0_usize;
        let mut total_results = 0_usize;

        while let Some(task_result) = tasks.next().await {
            completed_sources += 1;

            let send_result = match task_result {
                Ok((api_site, results)) => {
                    total_results += results.len();
                    tx.send(Ok(Event::default().data(
                        json!({
                            "type": "source_result",
                            "source": api_site.key,
                            "sourceName": api_site.name,
                            "results": results,
                        })
                        .to_string(),
                    )))
                    .await
                }
                Err((api_site, error_message)) => {
                    tx.send(Ok(Event::default().data(
                        json!({
                            "type": "source_error",
                            "source": api_site.key,
                            "sourceName": api_site.name,
                            "error": error_message,
                        })
                        .to_string(),
                    )))
                    .await
                }
            };

            if send_result.is_err() {
                return;
            }
        }

        let _ = tx
            .send(Ok(Event::default().data(
                json!({
                    "type": "complete",
                    "completedSources": completed_sources,
                    "totalResults": total_results,
                })
                .to_string(),
            )))
            .await;
    });

    let event_stream = stream::unfold(rx, |mut rx| async {
        rx.recv().await.map(|event| (event, rx))
    });
    let mut response = Sse::new(event_stream).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    Ok(response)
}

pub(crate) async fn get_content_suggestions(
    State(state): State<AppState>,
    Query(params): Query<SearchQueryParams>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;

    if query.is_empty() {
        return Ok(Json(SuggestionsResponse {
            suggestions: Vec::new(),
        })
        .into_response());
    }

    let Some(first_site) = config.api_sites.iter().find(|site| !site.disabled) else {
        let mut response = Json(SuggestionsResponse {
            suggestions: Vec::new(),
        })
        .into_response();
        apply_query_cache_headers(response.headers_mut(), config.cache_time);
        return Ok(response);
    };

    let mut results = search_site(&state.client, first_site, &query, config.max_search_pages)
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if config.adult_content_filter_enabled {
        results = filter_adult_content_results(results);
    }

    let suggestions = build_content_suggestions(&query, &results);
    let mut response = Json(SuggestionsResponse { suggestions }).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

pub(crate) async fn search_all_sites(
    client: &reqwest::Client,
    config: &ServiceConfig,
    query: &str,
) -> Vec<SearchResult> {
    let tasks = config.api_sites.iter().cloned().map(|api_site| {
        let client = client.clone();
        let query = query.to_string();
        let max_search_pages = config.max_search_pages;

        async move {
            if api_site.disabled {
                return Vec::new();
            }

            match search_site(&client, &api_site, &query, max_search_pages).await {
                Ok(results) => results,
                Err(error) => {
                    warn!("search failed for {}: {}", api_site.name, error);
                    Vec::new()
                }
            }
        }
    });

    join_all(tasks)
        .await
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
}

pub(crate) async fn search_site(
    client: &reqwest::Client,
    api_site: &ApiSite,
    query: &str,
    max_search_pages: usize,
) -> Result<Vec<SearchResult>> {
    let first_page_url =
        build_collection_api_url(&api_site.api, &[("ac", "videolist"), ("wd", query)])?;
    let first_response = client
        .get(&first_page_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(std::time::Duration::from_millis(DEFAULT_SEARCH_TIMEOUT_MS))
        .send()
        .await?;

    if !first_response.status().is_success() {
        return Ok(Vec::new());
    }

    let first_payload = first_response.json::<Value>().await?;
    let mut results = parse_search_payload(&first_payload, api_site);
    let total_pages = parse_usize(first_payload.get("pagecount")).unwrap_or(1);
    let pages_to_fetch = total_pages
        .saturating_sub(1)
        .min(max_search_pages.saturating_sub(1));

    if pages_to_fetch == 0 {
        return Ok(results);
    }

    let page_tasks = (2..=(pages_to_fetch + 1)).map(|page_number| {
        let client = client.clone();
        let api_site = api_site.clone();
        let query = query.to_string();

        async move {
            let page_url = build_collection_api_url(
                &api_site.api,
                &[
                    ("ac", "videolist"),
                    ("wd", query.as_str()),
                    ("pg", page_number.to_string().as_str()),
                ],
            )?;
            let response = client
                .get(page_url)
                .headers(build_downstream_headers(&api_site, DEFAULT_WEB_UA, None))
                .timeout(std::time::Duration::from_millis(DEFAULT_SEARCH_TIMEOUT_MS))
                .send()
                .await?;

            if !response.status().is_success() {
                return Ok::<Vec<SearchResult>, anyhow::Error>(Vec::new());
            }

            let payload = response.json::<Value>().await?;
            Ok(parse_search_payload(&payload, &api_site))
        }
    });

    for page_result in join_all(page_tasks).await {
        match page_result {
            Ok(items) => results.extend(items),
            Err(error) => warn!("search page fetch failed for {}: {}", api_site.name, error),
        }
    }

    Ok(results)
}

fn parse_search_payload(payload: &Value, api_site: &ApiSite) -> Vec<SearchResult> {
    let Some(list) = payload.get("list").and_then(Value::as_array) else {
        return Vec::new();
    };

    list.iter()
        .filter_map(|item| parse_search_item(item, api_site))
        .filter(|result| !result.episodes.is_empty())
        .collect()
}

fn parse_search_item(item: &Value, api_site: &ApiSite) -> Option<SearchResult> {
    let id = value_to_string(item.get("vod_id"))?;
    let title = crate::collapse_whitespace(&value_to_string(item.get("vod_name"))?);
    let poster = value_to_string(item.get("vod_pic")).unwrap_or_default();
    let (episodes, episode_titles) =
        extract_episodes_from_play_url(value_to_string(item.get("vod_play_url")).as_deref());

    Some(SearchResult {
        id,
        title,
        poster,
        episodes,
        episodes_titles: episode_titles,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: value_to_string(item.get("vod_class")),
        year: normalize_year(value_to_string(item.get("vod_year")).as_deref()),
        desc: value_to_string(item.get("vod_content")).map(|value| clean_html_tags(&value)),
        type_name: value_to_string(item.get("type_name")),
        douban_id: value_to_i64(item.get("vod_douban_id")),
    })
}

fn build_content_suggestions(query: &str, results: &[SearchResult]) -> Vec<ContentSuggestion> {
    let query_lower = query.to_lowercase();
    let query_words = query_lower
        .split(|character: char| matches!(character, ' ' | '-' | ':' | '：' | '·' | '、'))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let mut seen = std::collections::BTreeMap::<String, ContentSuggestion>::new();

    for keyword in results
        .iter()
        .map(|result| result.title.as_str())
        .flat_map(|title| {
            title
                .split(|character: char| matches!(character, ' ' | '-' | ':' | '：' | '·' | '、'))
                .filter(|word| word.chars().count() > 1)
                .map(str::trim)
                .filter(|word| !word.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
    {
        let keyword_lower = keyword.to_lowercase();
        if !keyword_lower.contains(&query_lower) {
            continue;
        }

        let (score, suggestion_type) = if keyword_lower == query_lower {
            (2.0, "exact")
        } else if keyword_lower.starts_with(&query_lower) || keyword_lower.ends_with(&query_lower) {
            (1.8, "related")
        } else if query_words
            .iter()
            .any(|query_word| keyword_lower.contains(query_word))
        {
            (1.5, "related")
        } else {
            (1.0, "suggestion")
        };

        seen.entry(keyword.clone()).or_insert(ContentSuggestion {
            text: keyword,
            r#type: suggestion_type,
            score,
        });

        if seen.len() >= 8 {
            break;
        }
    }

    let mut suggestions = seen.into_values().collect::<Vec<_>>();
    suggestions.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                suggestion_type_priority(right.r#type).cmp(&suggestion_type_priority(left.r#type))
            })
            .then_with(|| left.text.cmp(&right.text))
    });
    suggestions.truncate(8);
    suggestions
}

fn suggestion_type_priority(value: &str) -> usize {
    match value {
        "exact" => 3,
        "related" => 2,
        _ => 1,
    }
}
