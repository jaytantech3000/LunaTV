use std::{collections::BTreeSet, sync::OnceLock};

use axum::{Json, extract::State, response::Response};
use regex::Regex;
use serde::Deserialize;

use crate::{
    AppError, AppResult, AppState, SearchResponse, SearchResult, ServiceConfig,
    filter_adult_content_results, no_store_json_response, normalize_positive_douban_id,
    search_all_sites,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackSourcePrefetchRequest {
    pub(crate) title: String,
    pub(crate) year: Option<String>,
    pub(crate) search_type: Option<String>,
    pub(crate) query: Option<String>,
    pub(crate) douban_id: Option<i64>,
    pub(crate) allow_adult_candidates: Option<bool>,
}

pub(crate) async fn search_playback_sources(
    State(state): State<AppState>,
    Json(params): Json<PlaybackSourcePrefetchRequest>,
) -> AppResult<Response> {
    let config = state
        .load_config()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let results = search_playback_sources_with_prefetch(&state.client, &config, &params).await;

    no_store_json_response(&SearchResponse { results })
}

fn chinese_digit_value(character: char) -> Option<u32> {
    match character {
        '零' | '〇' => Some(0),
        '一' => Some(1),
        '二' | '两' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn parse_loose_season_number(value: &str) -> Option<u32> {
    let normalized_value = value.trim().to_uppercase();
    if normalized_value.is_empty() {
        return None;
    }

    if normalized_value
        .chars()
        .all(|character| character.is_ascii_digit())
    {
        return normalized_value
            .parse::<u32>()
            .ok()
            .filter(|value| *value > 0);
    }

    if normalized_value
        .chars()
        .all(|character| matches!(character, 'I' | 'V' | 'X' | 'L' | 'C' | 'D' | 'M'))
    {
        let mut total = 0_u32;
        let mut previous = 0_u32;

        for character in normalized_value.chars().rev() {
            let current = match character {
                'I' => 1,
                'V' => 5,
                'X' => 10,
                'L' => 50,
                'C' => 100,
                'D' => 500,
                'M' => 1000,
                _ => return None,
            };

            if current < previous {
                total = total.saturating_sub(current);
            } else {
                total = total.saturating_add(current);
                previous = current;
            }
        }

        return (total > 0).then_some(total);
    }

    if normalized_value == "十" {
        return Some(10);
    }

    if let Some(ten_index) = normalized_value.find('十') {
        let tens_raw = &normalized_value[..ten_index];
        let units_raw = &normalized_value[(ten_index + '十'.len_utf8())..];
        let tens = if tens_raw.is_empty() {
            1
        } else if tens_raw.chars().count() == 1 {
            chinese_digit_value(tens_raw.chars().next()?)?
        } else {
            return None;
        };
        let units = if units_raw.is_empty() {
            0
        } else if units_raw.chars().count() == 1 {
            chinese_digit_value(units_raw.chars().next()?)?
        } else {
            return None;
        };

        if tens > 0 {
            return Some(tens * 10 + units);
        }
    }

    let digits = normalized_value
        .chars()
        .map(chinese_digit_value)
        .collect::<Option<Vec<_>>>()?;
    if digits.is_empty() {
        return None;
    }

    digits
        .into_iter()
        .map(|digit| char::from_digit(digit, 10))
        .collect::<Option<String>>()?
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
}

fn playback_numbered_season_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)第([零〇一二两三四五六七八九十IVXLCDM\d]+)(季|部|期)")
            .expect("valid numbered season regex")
    })
}

fn playback_named_season_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)season\s*([IVXLCDM\d]+)").expect("valid season regex"))
}

fn playback_preview_like_title_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)(预告(?:片)?|片花|花絮|先导(?:片)?|抢先版|彩蛋|番外|幕后|解说|速看|cut|剪辑)",
        )
        .expect("valid preview title regex")
    })
}

fn normalize_playback_season_markers(value: &str) -> String {
    let numbered_replaced =
        playback_numbered_season_regex().replace_all(value, |captures: &regex::Captures<'_>| {
            let raw_number = captures
                .get(1)
                .map(|item| item.as_str())
                .unwrap_or_default();
            match parse_loose_season_number(raw_number) {
                Some(number) => format!(" season{number} "),
                None => format!(" {raw_number} "),
            }
        });

    playback_named_season_regex()
        .replace_all(&numbered_replaced, |captures: &regex::Captures<'_>| {
            let raw_number = captures
                .get(1)
                .map(|item| item.as_str())
                .unwrap_or_default();
            match parse_loose_season_number(raw_number) {
                Some(number) => format!(" season{number} "),
                None => format!(" {raw_number} "),
            }
        })
        .into_owned()
}

fn normalize_playback_match_text(value: &str) -> String {
    normalize_playback_season_markers(value)
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '-' | '_'
                        | '.'
                        | '·'
                        | '•'
                        | '・'
                        | ':'
                        | '：'
                        | ','
                        | '，'
                        | '!'
                        | '！'
                        | '?'
                        | '？'
                        | '"'
                        | '\''
                        | '“'
                        | '”'
                        | '‘'
                        | '’'
                        | '`'
                        | '~'
                        | '('
                        | ')'
                        | '（'
                        | '）'
                        | '['
                        | ']'
                        | '【'
                        | '】'
                        | '{'
                        | '}'
                        | '<'
                        | '>'
                        | '《'
                        | '》'
                        | '/'
                        | '\\'
                        | '|'
                )
        })
        .collect()
}

fn is_preview_like_playback_title(value: &str) -> bool {
    playback_preview_like_title_regex().is_match(value)
}

pub(crate) fn build_playback_search_queries(params: &PlaybackSourcePrefetchRequest) -> Vec<String> {
    let year = params
        .year
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut seen_queries = BTreeSet::new();
    let mut queries = Vec::new();

    for value in [params.query.as_deref(), Some(params.title.as_str())] {
        let Some(base) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            continue;
        };

        let candidates = if year.is_empty() || base.contains(&year) {
            vec![base.to_string()]
        } else {
            vec![
                base.to_string(),
                format!("{base} {year}"),
                format!("{base}{year}"),
                format!("{base} ({year})"),
                format!("{base}({year})"),
            ]
        };

        for candidate in candidates {
            if seen_queries.insert(candidate.clone()) {
                queries.push(candidate);
            }
        }
    }

    queries
}

fn build_playback_title_match_candidates(params: &PlaybackSourcePrefetchRequest) -> Vec<String> {
    let mut seen_candidates = BTreeSet::new();
    let mut candidates = Vec::new();

    for value in [params.query.as_deref(), Some(params.title.as_str())] {
        let Some(normalized_value) = value
            .map(normalize_playback_match_text)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        if seen_candidates.insert(normalized_value.clone()) {
            candidates.push(normalized_value);
        }
    }

    candidates
}

fn score_normalized_playback_title_match(candidate: &str, expected: &str) -> Option<i32> {
    if candidate.is_empty() || expected.is_empty() {
        return None;
    }

    if candidate == expected {
        return Some(420);
    }

    if candidate.starts_with(expected) || expected.starts_with(candidate) {
        return Some(280);
    }

    if candidate.contains(expected) || expected.contains(candidate) {
        if candidate.chars().count().min(expected.chars().count()) < 3 {
            return None;
        }

        return Some(220);
    }

    None
}

fn matches_playback_search_type(result: &SearchResult, search_type: Option<&str>) -> bool {
    match search_type {
        Some("tv") => result.episodes.len() > 1,
        Some("movie") => result.episodes.len() == 1,
        _ => true,
    }
}

fn score_playback_search_result(
    result: &SearchResult,
    params: &PlaybackSourcePrefetchRequest,
) -> Option<i32> {
    let expected_douban_id = normalize_positive_douban_id(params.douban_id);
    let result_douban_id = normalize_positive_douban_id(result.douban_id);
    let matches_douban_id = expected_douban_id.is_some() && result_douban_id == expected_douban_id;
    let normalized_title = normalize_playback_match_text(&result.title);
    let title_scores = build_playback_title_match_candidates(params)
        .into_iter()
        .filter_map(|candidate| {
            score_normalized_playback_title_match(&normalized_title, &candidate)
        })
        .collect::<Vec<_>>();

    if !matches_douban_id && title_scores.is_empty() {
        return None;
    }

    let mut score = if matches_douban_id { 1000 } else { 0 };

    if let Some(title_score) = title_scores.into_iter().max() {
        score += title_score;
    }

    let expected_year = params
        .year
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let result_year = result.year.trim().to_lowercase();
    if !expected_year.is_empty() {
        if result_year == expected_year {
            score += 80;
        } else if !result_year.is_empty() {
            score -= 120;
        }
    }

    if params.search_type.is_some() {
        if matches_playback_search_type(result, params.search_type.as_deref()) {
            score += 40;
        } else {
            score -= 120;
        }
    }

    score += if result.episodes.len() > 1 { 10 } else { 5 };

    Some(score)
}

fn build_playback_search_result_key(result: &SearchResult) -> String {
    format!("{}-{}", result.source, result.id)
}

fn merge_playback_search_results(
    existing: Vec<SearchResult>,
    incoming: Vec<SearchResult>,
) -> Vec<SearchResult> {
    if incoming.is_empty() {
        return existing;
    }

    let mut merged = existing;
    let mut seen_keys = merged
        .iter()
        .map(build_playback_search_result_key)
        .collect::<BTreeSet<_>>();

    for result in incoming {
        let key = build_playback_search_result_key(&result);
        if seen_keys.insert(key) {
            merged.push(result);
        }
    }

    merged
}

fn has_exact_playback_douban_match(
    sources: &[SearchResult],
    expected_douban_id: Option<i64>,
) -> bool {
    let Some(expected_douban_id) = expected_douban_id else {
        return false;
    };

    sources
        .iter()
        .any(|source| normalize_positive_douban_id(source.douban_id) == Some(expected_douban_id))
}

fn has_high_confidence_playback_douban_match(
    sources: &[SearchResult],
    params: &PlaybackSourcePrefetchRequest,
) -> bool {
    let Some(expected_douban_id) = normalize_positive_douban_id(params.douban_id) else {
        return !sources.is_empty();
    };

    let exact_matches = sources
        .iter()
        .filter(|source| normalize_positive_douban_id(source.douban_id) == Some(expected_douban_id))
        .collect::<Vec<_>>();

    if exact_matches.is_empty() {
        return false;
    }

    if matches!(params.search_type.as_deref(), Some("movie")) {
        return exact_matches
            .into_iter()
            .any(|source| !is_preview_like_playback_title(&source.title));
    }

    exact_matches
        .into_iter()
        .any(|source| source.episodes.len() > 1 && !is_preview_like_playback_title(&source.title))
}

pub(crate) fn filter_playback_search_results(
    results: Vec<SearchResult>,
    params: &PlaybackSourcePrefetchRequest,
) -> Vec<SearchResult> {
    let candidate_results = if params.allow_adult_candidates.unwrap_or(false) {
        results
    } else {
        filter_adult_content_results(results)
    };

    let mut scored_results = candidate_results
        .into_iter()
        .filter_map(|result| {
            score_playback_search_result(&result, params).map(|score| (result, score))
        })
        .collect::<Vec<_>>();

    scored_results.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| right.0.episodes.len().cmp(&left.0.episodes.len()))
            .then_with(|| left.0.title.cmp(&right.0.title))
    });

    if let Some(expected_douban_id) = normalize_positive_douban_id(params.douban_id) {
        let exact_matches = scored_results
            .iter()
            .filter(|(result, _)| {
                normalize_positive_douban_id(result.douban_id) == Some(expected_douban_id)
            })
            .map(|(result, _)| result.clone())
            .collect::<Vec<_>>();

        if !exact_matches.is_empty() {
            let multi_episode_exact_matches = exact_matches
                .iter()
                .filter(|result| result.episodes.len() > 1)
                .cloned()
                .collect::<Vec<_>>();
            let exact_match_pool = if multi_episode_exact_matches.is_empty() {
                exact_matches
            } else {
                multi_episode_exact_matches
            };
            let non_preview_exact_matches = exact_match_pool
                .iter()
                .filter(|result| !is_preview_like_playback_title(&result.title))
                .cloned()
                .collect::<Vec<_>>();

            return if non_preview_exact_matches.is_empty() {
                exact_match_pool
            } else {
                non_preview_exact_matches
            };
        }
    }

    let strict_matches = scored_results
        .iter()
        .filter(|(_, score)| *score >= 220)
        .map(|(result, _)| result.clone())
        .collect::<Vec<_>>();
    if !strict_matches.is_empty() {
        return strict_matches;
    }

    scored_results
        .into_iter()
        .filter(|(_, score)| *score >= 180)
        .take(3)
        .map(|(result, _)| result)
        .collect()
}

async fn search_playback_sources_with_prefetch(
    client: &reqwest::Client,
    config: &ServiceConfig,
    params: &PlaybackSourcePrefetchRequest,
) -> Vec<SearchResult> {
    let queries = build_playback_search_queries(params);
    let expected_douban_id = normalize_positive_douban_id(params.douban_id);

    if queries.is_empty() {
        return Vec::new();
    }

    let mut aggregated_results = Vec::new();
    let mut fallback_sources = Vec::new();

    for query in queries {
        let mut raw_results = search_all_sites(client, config, &query).await;
        if config.adult_content_filter_enabled || !params.allow_adult_candidates.unwrap_or(false) {
            raw_results = filter_adult_content_results(raw_results);
        }

        aggregated_results = merge_playback_search_results(aggregated_results, raw_results);
        if aggregated_results.is_empty() {
            continue;
        }

        let sources = filter_playback_search_results(aggregated_results.clone(), params);
        if sources.is_empty() {
            continue;
        }

        fallback_sources = sources.clone();

        if expected_douban_id.is_none()
            || (has_exact_playback_douban_match(&sources, expected_douban_id)
                && has_high_confidence_playback_douban_match(&sources, params))
        {
            return sources;
        }
    }

    fallback_sources
}
