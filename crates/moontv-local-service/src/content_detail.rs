use std::sync::OnceLock;

use axum::{
    Json,
    extract::{Query, State},
    response::{IntoResponse, Response},
};
use regex::Regex;
use serde_json::Value;

use crate::{
    ApiSite, AppError, AppResult, AppState, DEFAULT_DETAIL_TIMEOUT_MS, DEFAULT_WEB_UA,
    DetailQueryParams, SearchResult, apply_query_cache_headers, build_collection_api_url,
    build_downstream_headers, clean_html_tags, extract_episodes_from_play_url, is_valid_content_id,
    normalize_year, value_to_i64, value_to_string,
};

pub(crate) async fn get_content_detail(
    State(state): State<AppState>,
    Query(params): Query<DetailQueryParams>,
) -> AppResult<Response> {
    let id = params.id.unwrap_or_default().trim().to_string();
    let source = params.source.unwrap_or_default().trim().to_string();

    if id.is_empty() || source.is_empty() {
        return Err(AppError::bad_request("缺少必要参数"));
    }

    if !is_valid_content_id(&id) {
        return Err(AppError::bad_request("无效的视频ID格式"));
    }

    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let api_site = config
        .api_sites
        .iter()
        .find(|item| item.key == source && !item.disabled)
        .cloned()
        .ok_or_else(|| AppError::bad_request("无效的API来源"))?;

    let result = fetch_content_detail(&state.client, &api_site, &id).await?;
    let mut response = Json(result).into_response();
    apply_query_cache_headers(response.headers_mut(), config.cache_time);
    Ok(response)
}

async fn fetch_content_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    if has_custom_detail_url(api_site) {
        fetch_custom_detail(client, api_site, id).await
    } else {
        fetch_json_detail(client, api_site, id).await
    }
}

async fn fetch_json_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    let detail_url = build_collection_api_url(&api_site.api, &[("ac", "videolist"), ("ids", id)])
        .map_err(|error| AppError::internal(error.to_string()))?;
    let response = client
        .get(detail_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(std::time::Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "详情请求失败: {}",
            response.status()
        )));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    parse_detail_payload(&payload, api_site, id)
        .ok_or_else(|| AppError::internal("获取到的详情内容无效"))
}

async fn fetch_custom_detail(
    client: &reqwest::Client,
    api_site: &ApiSite,
    id: &str,
) -> AppResult<SearchResult> {
    let detail_base = api_site
        .detail
        .as_deref()
        .ok_or_else(|| AppError::internal("detail 配置缺失"))?;
    let detail_url = format!(
        "{}/index.php/vod/detail/id/{}.html",
        detail_base.trim_end_matches('/'),
        id
    );
    let response = client
        .get(detail_url)
        .headers(build_downstream_headers(api_site, DEFAULT_WEB_UA, None))
        .timeout(std::time::Duration::from_millis(DEFAULT_DETAIL_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "详情页请求失败: {}",
            response.status()
        )));
    }

    let html = response
        .text()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(parse_custom_detail_html(&html, api_site, id))
}

pub(crate) fn parse_detail_payload(
    payload: &Value,
    api_site: &ApiSite,
    id: &str,
) -> Option<SearchResult> {
    let list = payload.get("list")?.as_array()?;
    let video_detail = list.first()?;
    let (mut episodes, mut episode_titles) = extract_episodes_from_play_url(
        value_to_string(video_detail.get("vod_play_url")).as_deref(),
    );

    if episodes.is_empty() {
        if let Some(content) = value_to_string(video_detail.get("vod_content")) {
            episodes = extract_m3u8_matches(&content);
            episode_titles = (1..=episodes.len())
                .map(|index| index.to_string())
                .collect::<Vec<_>>();
        }
    }

    Some(SearchResult {
        id: id.to_string(),
        title: value_to_string(video_detail.get("vod_name")).unwrap_or_default(),
        poster: value_to_string(video_detail.get("vod_pic")).unwrap_or_default(),
        episodes,
        episodes_titles: episode_titles,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: value_to_string(video_detail.get("vod_class")),
        year: normalize_year(value_to_string(video_detail.get("vod_year")).as_deref()),
        desc: value_to_string(video_detail.get("vod_content")).map(|value| clean_html_tags(&value)),
        type_name: value_to_string(video_detail.get("type_name")),
        douban_id: value_to_i64(video_detail.get("vod_douban_id")),
    })
}

fn parse_custom_detail_html(html: &str, api_site: &ApiSite, id: &str) -> SearchResult {
    let mut matches = if matches!(api_site.key.as_str(), "ffzy" | "feifan") {
        html.special_ffzy_m3u8_regex()
            .captures_iter(html)
            .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    if matches.is_empty() {
        matches = html
            .m3u8_regex()
            .captures_iter(html)
            .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
            .collect::<Vec<_>>();
    }

    let mut deduped_matches = Vec::new();
    for raw_match in matches {
        let cleaned_match = raw_match
            .trim()
            .trim_start_matches('$')
            .split('(')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();

        if !cleaned_match.is_empty() && !deduped_matches.contains(&cleaned_match) {
            deduped_matches.push(cleaned_match);
        }
    }

    let title = html
        .title_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().trim().to_string())
        .unwrap_or_default();
    let desc = html
        .detail_desc_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| clean_html_tags(item.as_str()));
    let poster = html
        .cover_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().trim().to_string())
        .unwrap_or_default();
    let year = html
        .year_regex()
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    SearchResult {
        id: id.to_string(),
        title,
        poster,
        episodes_titles: (1..=deduped_matches.len())
            .map(|index| index.to_string())
            .collect::<Vec<_>>(),
        episodes: deduped_matches,
        source: api_site.key.clone(),
        source_name: api_site.name.clone(),
        class: Some(String::new()),
        year,
        desc,
        type_name: Some(String::new()),
        douban_id: Some(0),
    }
}

trait RegexExt {
    fn m3u8_regex(&self) -> &Regex;
    fn special_ffzy_m3u8_regex(&self) -> &Regex;
    fn title_regex(&self) -> &Regex;
    fn detail_desc_regex(&self) -> &Regex;
    fn cover_regex(&self) -> &Regex;
    fn year_regex(&self) -> &Regex;
}

impl RegexExt for str {
    fn m3u8_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"\$(https?://[^"'\s]+?\.m3u8(?:\?[^"'\s]*)?)"#).expect("valid m3u8 regex")
        })
    }

    fn special_ffzy_m3u8_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"\$(https?://[^"'\s]+?/\d{8}/\d+_[a-f0-9]+/index\.m3u8)"#)
                .expect("valid ffzy detail regex")
        })
    }

    fn title_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| Regex::new(r#"<h1[^>]*>([^<]+)</h1>"#).expect("valid title regex"))
    }

    fn detail_desc_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)</div>"#)
                .expect("valid desc regex")
        })
    }

    fn cover_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| {
            Regex::new(r#"(https?://[^"'\s]+?\.(jpg|jpeg|png|webp))"#).expect("valid cover regex")
        })
    }

    fn year_regex(&self) -> &Regex {
        static REGEX: OnceLock<Regex> = OnceLock::new();
        REGEX.get_or_init(|| Regex::new(r#">(\d{4})<"#).expect("valid year regex"))
    }
}

fn extract_m3u8_matches(content: &str) -> Vec<String> {
    content
        .m3u8_regex()
        .captures_iter(content)
        .filter_map(|capture| capture.get(1).map(|item| item.as_str().to_string()))
        .collect()
}

fn has_custom_detail_url(api_site: &ApiSite) -> bool {
    api_site
        .detail
        .as_deref()
        .map(|detail| detail.starts_with("http://") || detail.starts_with("https://"))
        .unwrap_or(false)
}
