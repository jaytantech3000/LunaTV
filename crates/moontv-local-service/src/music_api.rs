use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, Method, StatusCode,
        header::{CACHE_CONTROL, LOCATION, RANGE, REFERER, USER_AGENT},
    },
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{AppError, AppResult, AppState, DEFAULT_PROXY_TIMEOUT_MS};

const NETEASE_SOURCE_KEY: &str = "netease";
const NETEASE_SOURCE_NAME: &str = "网易云音乐";
const NETEASE_REFERER: &str = "https://music.163.com/";
const MUSIC_SOURCE_TABS: &[&str] = &["home", "rank", "hot", "playlist", "search"];
const DISABLED_MUSIC_SOURCE_TABS: &[&str] = &["home", "search"];
const HOME_TOPLIST_LIMIT: usize = 6;
const HOME_PLAYLIST_LIMIT: usize = 6;
const SEARCH_TRACK_LIMIT: usize = 12;
const SEARCH_PLAYLIST_LIMIT: usize = 6;
const SUMMARY_ACCENT_COLORS: &[&str] = &[
    "#ff5f6d", "#7b61ff", "#0ea5e9", "#0f766e", "#22c55e", "#f97316",
];

#[derive(Debug, Deserialize)]
pub(crate) struct MusicSourceQuery {
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MusicSearchQuery {
    source: Option<String>,
    q: Option<String>,
    page: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MusicCollectionQuery {
    source: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MusicTrackQuery {
    source: Option<String>,
    id: Option<String>,
    quality: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicSourcesPayload {
    sources: Vec<MusicSourcePayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicSourcePayload {
    key: String,
    name: String,
    provider: String,
    enabled: bool,
    tabs: Vec<String>,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicHomePayload {
    source: String,
    spotlight: Vec<MusicTrackPayload>,
    sections: Vec<MusicHomeSectionPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicHomeSectionPayload {
    id: String,
    title: String,
    tab: String,
    kind: String,
    description: Option<String>,
    collections: Option<Vec<MusicCollectionSummaryPayload>>,
    tracks: Option<Vec<MusicTrackPayload>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicCollectionSummaryPayload {
    id: String,
    source: String,
    kind: String,
    title: String,
    cover: Option<String>,
    description: Option<String>,
    track_count: Option<usize>,
    accent_color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicCollectionPayload {
    id: String,
    source: String,
    kind: String,
    title: String,
    cover: Option<String>,
    description: Option<String>,
    track_count: Option<usize>,
    accent_color: Option<String>,
    tracks: Vec<MusicTrackPayload>,
    curator: Option<String>,
    updated_at_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicTrackPayload {
    id: String,
    source: String,
    title: String,
    artists: Vec<MusicArtistPayload>,
    album: Option<MusicAlbumPayload>,
    cover: Option<String>,
    duration_ms: Option<u64>,
    playable: bool,
    subtitle: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MusicArtistPayload {
    id: Option<String>,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicAlbumPayload {
    id: Option<String>,
    title: String,
    cover: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicSearchPayload {
    source: String,
    query: String,
    tracks: Vec<MusicTrackPayload>,
    collections: Vec<MusicCollectionSummaryPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicTrackDetailPayload {
    track: MusicTrackPayload,
    stream_url: String,
    quality: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicLyricPayload {
    track_id: String,
    source: String,
    lines: Vec<MusicLyricLinePayload>,
    offset_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicLyricLinePayload {
    time_ms: i64,
    text: String,
    translation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteaseToplistResponse {
    #[serde(default)]
    list: Vec<NeteaseToplist>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseToplist {
    id: i64,
    name: String,
    #[serde(default)]
    cover_img_url: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    track_count: usize,
    #[serde(default)]
    update_frequency: String,
}

#[derive(Debug, Deserialize)]
struct NeteasePersonalizedPlaylistResponse {
    #[serde(default)]
    result: Vec<NeteasePlaylistRecommendation>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteasePlaylistRecommendation {
    id: i64,
    name: String,
    #[serde(default)]
    pic_url: String,
    #[serde(default)]
    copywriter: String,
    #[serde(default)]
    track_count: usize,
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResponse {
    result: Option<NeteaseSearchResult>,
}

#[derive(Debug, Default, Deserialize)]
struct NeteaseSearchResult {
    #[serde(default)]
    songs: Vec<NeteaseSong>,
    #[serde(default)]
    playlists: Vec<NeteaseSearchPlaylist>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseSearchPlaylist {
    id: i64,
    name: String,
    #[serde(default)]
    cover_img_url: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    track_count: usize,
}

#[derive(Debug, Deserialize)]
struct NeteasePlaylistDetailResponse {
    result: NeteasePlaylistDetail,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteasePlaylistDetail {
    id: i64,
    name: String,
    #[serde(default)]
    cover_img_url: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    track_count: usize,
    #[serde(default)]
    update_frequency: String,
    #[serde(default)]
    creator: Option<NeteaseCreator>,
    #[serde(default)]
    tracks: Vec<NeteaseSong>,
}

#[derive(Debug, Clone, Deserialize)]
struct NeteaseCreator {
    nickname: String,
}

#[derive(Debug, Deserialize)]
struct NeteaseSongDetailResponse {
    #[serde(default)]
    songs: Vec<NeteaseSong>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseSong {
    id: i64,
    name: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    artists: Vec<NeteaseArtist>,
    #[serde(default)]
    album: Option<NeteaseAlbum>,
}

#[derive(Debug, Clone, Deserialize)]
struct NeteaseArtist {
    id: i64,
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseAlbum {
    id: i64,
    name: String,
    #[serde(default)]
    pic_url: String,
}

#[derive(Debug, Deserialize)]
struct NeteaseLyricResponse {
    #[serde(default)]
    lrc: Option<NeteaseLyricBlock>,
    #[serde(default)]
    tlyric: Option<NeteaseLyricBlock>,
}

#[derive(Debug, Default, Deserialize)]
struct NeteaseLyricBlock {
    #[serde(default)]
    lyric: String,
}

pub(crate) async fn get_music_sources() -> AppResult<Response> {
    Ok(no_store_json_response(MusicSourcesPayload {
        sources: vec![
            MusicSourcePayload {
                key: NETEASE_SOURCE_KEY.to_string(),
                name: NETEASE_SOURCE_NAME.to_string(),
                provider: NETEASE_SOURCE_KEY.to_string(),
                enabled: true,
                tabs: MUSIC_SOURCE_TABS
                    .iter()
                    .map(|tab| (*tab).to_string())
                    .collect(),
                description: Some("桌面本地模式已接入真实网易云公开数据。".to_string()),
            },
            MusicSourcePayload {
                key: "qq".to_string(),
                name: "QQ 音乐".to_string(),
                provider: "qq".to_string(),
                enabled: false,
                tabs: DISABLED_MUSIC_SOURCE_TABS
                    .iter()
                    .map(|tab| (*tab).to_string())
                    .collect(),
                description: Some("接入中，暂未开放。".to_string()),
            },
            MusicSourcePayload {
                key: "kugou".to_string(),
                name: "酷狗音乐".to_string(),
                provider: "kugou".to_string(),
                enabled: false,
                tabs: DISABLED_MUSIC_SOURCE_TABS
                    .iter()
                    .map(|tab| (*tab).to_string())
                    .collect(),
                description: Some("接入中，暂未开放。".to_string()),
            },
        ],
    }))
}

pub(crate) async fn get_music_home(
    State(state): State<AppState>,
    Query(params): Query<MusicSourceQuery>,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let toplists = fetch_netease_toplists(&state).await?;
    let playlists = fetch_netease_recommended_playlists(&state).await?;
    let spotlight = if let Some(first_toplist) = toplists.first() {
        fetch_netease_playlist_detail(&state, &first_toplist.id)
            .await?
            .tracks
            .into_iter()
            .take(8)
            .map(to_music_track_payload)
            .collect()
    } else {
        Vec::new()
    };

    let rank_collections = toplists
        .iter()
        .take(HOME_TOPLIST_LIMIT)
        .enumerate()
        .map(|(index, item)| to_toplist_summary(item, index))
        .collect();
    let playlist_collections = playlists
        .iter()
        .take(HOME_PLAYLIST_LIMIT)
        .enumerate()
        .map(|(index, item)| to_playlist_summary(item, index))
        .collect();
    let hot_description = toplists
        .first()
        .map(|item| {
            format!(
                "来自 {} · {}",
                item.name,
                fallback_label(&item.update_frequency, "实时更新")
            )
        })
        .unwrap_or_else(|| "来自网易云公开榜单。".to_string());

    Ok(no_store_json_response(MusicHomePayload {
        source: NETEASE_SOURCE_KEY.to_string(),
        spotlight: spotlight.clone(),
        sections: vec![
            MusicHomeSectionPayload {
                id: "netease-rank".to_string(),
                title: "官方榜单".to_string(),
                tab: "rank".to_string(),
                kind: "collection-list".to_string(),
                description: Some("直接取自网易云公开榜单接口。".to_string()),
                collections: Some(rank_collections),
                tracks: None,
            },
            MusicHomeSectionPayload {
                id: "netease-hot".to_string(),
                title: "热门单曲".to_string(),
                tab: "hot".to_string(),
                kind: "track-list".to_string(),
                description: Some(hot_description),
                collections: None,
                tracks: Some(spotlight),
            },
            MusicHomeSectionPayload {
                id: "netease-playlist".to_string(),
                title: "推荐歌单".to_string(),
                tab: "playlist".to_string(),
                kind: "collection-list".to_string(),
                description: Some("来自网易云公开推荐歌单接口。".to_string()),
                collections: Some(playlist_collections),
                tracks: None,
            },
        ],
    }))
}

pub(crate) async fn get_music_search(
    State(state): State<AppState>,
    Query(params): Query<MusicSearchQuery>,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let query = params.q.unwrap_or_default().trim().to_string();
    let page = params.page.unwrap_or(1).max(1);

    if query.is_empty() {
        return Ok(no_store_json_response(MusicSearchPayload {
            source: NETEASE_SOURCE_KEY.to_string(),
            query,
            tracks: Vec::new(),
            collections: Vec::new(),
        }));
    }

    let (tracks, collections) = tokio::try_join!(
        fetch_netease_search_tracks(&state, &query, page),
        fetch_netease_search_playlists(&state, &query, page),
    )?;

    Ok(no_store_json_response(MusicSearchPayload {
        source: NETEASE_SOURCE_KEY.to_string(),
        query,
        tracks: tracks
            .into_iter()
            .take(SEARCH_TRACK_LIMIT)
            .map(to_music_track_payload)
            .collect(),
        collections: collections
            .into_iter()
            .take(SEARCH_PLAYLIST_LIMIT)
            .enumerate()
            .map(|(index, item)| to_search_playlist_summary(&item, index))
            .collect(),
    }))
}

pub(crate) async fn get_music_collection(
    State(state): State<AppState>,
    Query(params): Query<MusicCollectionQuery>,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let playlist_id = require_query_value(params.id.as_deref(), "Missing playlist id")?;
    let playlist = fetch_netease_playlist_detail(
        &state,
        &playlist_id
            .parse()
            .map_err(|_| AppError::bad_request("Invalid playlist id"))?,
    )
    .await?;

    Ok(no_store_json_response(MusicCollectionPayload {
        id: playlist.id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: playlist.name,
        cover: normalize_remote_url(&playlist.cover_img_url),
        description: playlist.description,
        track_count: Some(playlist.track_count),
        accent_color: Some(SUMMARY_ACCENT_COLORS[0].to_string()),
        tracks: playlist
            .tracks
            .into_iter()
            .map(to_music_track_payload)
            .collect(),
        curator: playlist.creator.map(|creator| creator.nickname),
        updated_at_label: normalize_optional_text(Some(playlist.update_frequency)),
    }))
}

pub(crate) async fn get_music_track(
    State(state): State<AppState>,
    Query(params): Query<MusicTrackQuery>,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let track_id = require_query_value(params.id.as_deref(), "Missing track id")?;
    let quality = normalize_optional_text(params.quality).unwrap_or_else(|| "standard".to_string());
    let song = fetch_netease_song_detail(
        &state,
        &track_id
            .parse()
            .map_err(|_| AppError::bad_request("Invalid track id"))?,
    )
    .await?;

    Ok(no_store_json_response(MusicTrackDetailPayload {
        track: to_music_track_payload(song),
        stream_url: format!(
            "/media/audio/stream?source={NETEASE_SOURCE_KEY}&id={track_id}&quality={quality}"
        ),
        quality,
    }))
}

pub(crate) async fn get_music_lyric(
    State(state): State<AppState>,
    Query(params): Query<MusicTrackQuery>,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let track_id = require_query_value(params.id.as_deref(), "Missing track id")?;
    let lyric = fetch_netease_lyric(
        &state,
        &track_id
            .parse()
            .map_err(|_| AppError::bad_request("Invalid track id"))?,
    )
    .await?;
    let translation_map = parse_lrc_lines(
        lyric
            .tlyric
            .as_ref()
            .map(|value| value.lyric.as_str())
            .unwrap_or_default(),
    )
    .into_iter()
    .map(|line| (line.time_ms, line.text))
    .collect::<std::collections::BTreeMap<_, _>>();
    let lines = parse_lrc_lines(
        lyric
            .lrc
            .as_ref()
            .map(|value| value.lyric.as_str())
            .unwrap_or_default(),
    )
    .into_iter()
    .map(|line| MusicLyricLinePayload {
        translation: translation_map.get(&line.time_ms).cloned(),
        ..line
    })
    .collect();

    Ok(no_store_json_response(MusicLyricPayload {
        track_id,
        source: NETEASE_SOURCE_KEY.to_string(),
        lines,
        offset_ms: None,
    }))
}

pub(crate) async fn get_music_audio_stream(
    method: Method,
    State(state): State<AppState>,
    Query(params): Query<MusicTrackQuery>,
    request_headers: HeaderMap,
) -> AppResult<Response> {
    resolve_netease_source(params.source.as_deref())?;
    let track_id = require_query_value(params.id.as_deref(), "Missing track id")?;
    let upstream_response =
        fetch_netease_stream_upstream(&state, &track_id, &request_headers).await?;

    if !upstream_response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch audio stream: {}",
            upstream_response.status()
        )));
    }

    let meta = crate::upstream_response_meta(&upstream_response);
    let mut response = if method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from_stream(upstream_response.bytes_stream()))
    };
    *response.status_mut() = meta.status;
    *response.headers_mut() = crate::create_live_proxy_headers(
        &meta,
        meta.content_type.as_deref().unwrap_or("audio/mpeg"),
        meta.content_length.clone(),
        true,
        Some("no-store"),
    );
    Ok(response)
}

async fn fetch_netease_toplists(state: &AppState) -> AppResult<Vec<NeteaseToplist>> {
    Ok(
        fetch_netease_json::<NeteaseToplistResponse>(state, "/api/toplist", &[])
            .await?
            .list,
    )
}

async fn fetch_netease_recommended_playlists(
    state: &AppState,
) -> AppResult<Vec<NeteasePlaylistRecommendation>> {
    Ok(fetch_netease_json::<NeteasePersonalizedPlaylistResponse>(
        state,
        "/api/personalized/playlist",
        &[("limit", HOME_PLAYLIST_LIMIT.to_string())],
    )
    .await?
    .result)
}

async fn fetch_netease_search_tracks(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<NeteaseSong>> {
    let offset = (page.saturating_sub(1)) * SEARCH_TRACK_LIMIT;
    let payload = fetch_netease_json::<NeteaseSearchResponse>(
        state,
        "/api/search/get/web",
        &[
            ("csrf_token", String::new()),
            ("s", query.to_string()),
            ("type", "1".to_string()),
            ("offset", offset.to_string()),
            ("limit", SEARCH_TRACK_LIMIT.to_string()),
        ],
    )
    .await?;
    Ok(payload.result.unwrap_or_default().songs)
}

async fn fetch_netease_search_playlists(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<NeteaseSearchPlaylist>> {
    let offset = (page.saturating_sub(1)) * SEARCH_PLAYLIST_LIMIT;
    let payload = fetch_netease_json::<NeteaseSearchResponse>(
        state,
        "/api/search/get/web",
        &[
            ("csrf_token", String::new()),
            ("s", query.to_string()),
            ("type", "1000".to_string()),
            ("offset", offset.to_string()),
            ("limit", SEARCH_PLAYLIST_LIMIT.to_string()),
        ],
    )
    .await?;
    Ok(payload.result.unwrap_or_default().playlists)
}

async fn fetch_netease_playlist_detail(
    state: &AppState,
    playlist_id: &i64,
) -> AppResult<NeteasePlaylistDetail> {
    Ok(fetch_netease_json::<NeteasePlaylistDetailResponse>(
        state,
        "/api/playlist/detail",
        &[("id", playlist_id.to_string())],
    )
    .await?
    .result)
}

async fn fetch_netease_song_detail(state: &AppState, track_id: &i64) -> AppResult<NeteaseSong> {
    let payload = fetch_netease_json::<NeteaseSongDetailResponse>(
        state,
        "/api/song/detail",
        &[("ids", format!("[{track_id}]"))],
    )
    .await?;
    payload
        .songs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "Track not found"))
}

async fn fetch_netease_lyric(state: &AppState, track_id: &i64) -> AppResult<NeteaseLyricResponse> {
    fetch_netease_json(
        state,
        "/api/song/lyric",
        &[
            ("id", track_id.to_string()),
            ("lv", "-1".to_string()),
            ("tv", "-1".to_string()),
        ],
    )
    .await
}

async fn fetch_netease_stream_upstream(
    state: &AppState,
    track_id: &str,
    request_headers: &HeaderMap,
) -> AppResult<reqwest::Response> {
    let redirect_response = state
        .no_redirect_client
        .get(build_netease_endpoint(
            &state.netease_api_base_url,
            "/song/media/outer/url",
        ))
        .query(&[("id", format!("{track_id}.mp3"))])
        .headers(build_netease_request_headers(None, false))
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let final_url = if redirect_response.status().is_redirection() {
        let location = redirect_response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AppError::internal("Missing audio stream redirect location"))?;
        crate::resolve_url(redirect_response.url().as_str(), location)
    } else {
        redirect_response.url().to_string()
    };

    state
        .client
        .get(final_url)
        .headers(build_netease_request_headers(Some(request_headers), true))
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

async fn fetch_netease_json<T>(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
) -> AppResult<T>
where
    T: DeserializeOwned,
{
    state
        .client
        .get(build_netease_endpoint(&state.netease_api_base_url, path))
        .query(query)
        .headers(build_netease_request_headers(None, false))
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
        .json::<T>()
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

fn build_netease_request_headers(
    request_headers: Option<&HeaderMap>,
    include_range: bool,
) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(crate::DEFAULT_WEB_UA));
    headers.insert(REFERER, HeaderValue::from_static(NETEASE_REFERER));

    if include_range {
        if let Some(range_value) = request_headers.and_then(|headers| headers.get(RANGE)) {
            headers.insert(RANGE, range_value.clone());
        }
    }

    headers
}

fn build_netease_endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn resolve_netease_source(source: Option<&str>) -> AppResult<()> {
    let normalized = source.unwrap_or(NETEASE_SOURCE_KEY).trim();
    if normalized.is_empty() || normalized == NETEASE_SOURCE_KEY {
        return Ok(());
    }

    Err(AppError::bad_request("Unsupported music source"))
}

fn require_query_value(value: Option<&str>, error_message: &str) -> AppResult<String> {
    normalize_optional_text(value.map(str::to_string))
        .ok_or_else(|| AppError::bad_request(error_message))
}

fn to_toplist_summary(item: &NeteaseToplist, index: usize) -> MusicCollectionSummaryPayload {
    MusicCollectionSummaryPayload {
        id: item.id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        kind: "rank".to_string(),
        title: item.name.clone(),
        cover: normalize_remote_url(&item.cover_img_url),
        description: normalize_optional_text(Some(item.description.clone())),
        track_count: Some(item.track_count),
        accent_color: Some(pick_accent_color(index)),
    }
}

fn to_playlist_summary(
    item: &NeteasePlaylistRecommendation,
    index: usize,
) -> MusicCollectionSummaryPayload {
    MusicCollectionSummaryPayload {
        id: item.id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: item.name.clone(),
        cover: normalize_remote_url(&item.pic_url),
        description: normalize_optional_text(Some(item.copywriter.clone())),
        track_count: Some(item.track_count),
        accent_color: Some(pick_accent_color(index + 1)),
    }
}

fn to_search_playlist_summary(
    item: &NeteaseSearchPlaylist,
    index: usize,
) -> MusicCollectionSummaryPayload {
    MusicCollectionSummaryPayload {
        id: item.id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: item.name.clone(),
        cover: normalize_remote_url(&item.cover_img_url),
        description: normalize_optional_text(item.description.clone()),
        track_count: Some(item.track_count),
        accent_color: Some(pick_accent_color(index + 2)),
    }
}

fn to_music_track_payload(song: NeteaseSong) -> MusicTrackPayload {
    let album = song.album.as_ref().map(|album| MusicAlbumPayload {
        id: Some(album.id.to_string()),
        title: album.name.clone(),
        cover: normalize_remote_url(&album.pic_url),
    });
    let cover = song
        .album
        .as_ref()
        .and_then(|album| normalize_remote_url(&album.pic_url));
    let subtitle = song
        .album
        .as_ref()
        .and_then(|album| normalize_optional_text(Some(album.name.clone())));

    MusicTrackPayload {
        id: song.id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        title: song.name,
        artists: song
            .artists
            .into_iter()
            .map(|artist| MusicArtistPayload {
                id: Some(artist.id.to_string()),
                name: artist.name,
            })
            .collect(),
        album,
        cover,
        duration_ms: (song.duration > 0).then_some(song.duration),
        playable: true,
        subtitle,
    }
}

fn parse_lrc_lines(content: &str) -> Vec<MusicLyricLinePayload> {
    let mut lines = Vec::new();

    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut cursor = trimmed;
        let mut timestamps = Vec::new();
        while let Some(rest) = cursor.strip_prefix('[') {
            let Some((timestamp, tail)) = rest.split_once(']') else {
                break;
            };
            let Some(time_ms) = parse_lrc_timestamp(timestamp) else {
                break;
            };
            timestamps.push(time_ms);
            cursor = tail;
        }

        let text = cursor.trim();
        if timestamps.is_empty() || text.is_empty() {
            continue;
        }

        for time_ms in timestamps {
            lines.push(MusicLyricLinePayload {
                time_ms,
                text: text.to_string(),
                translation: None,
            });
        }
    }

    lines.sort_by_key(|line| line.time_ms);
    lines
}

fn parse_lrc_timestamp(timestamp: &str) -> Option<i64> {
    let (minutes_raw, seconds_raw) = timestamp.split_once(':')?;
    let minutes = minutes_raw.parse::<i64>().ok()?;
    let (seconds, fractional_ms) =
        if let Some((seconds_raw, fraction_raw)) = seconds_raw.split_once('.') {
            let seconds = seconds_raw.parse::<i64>().ok()?;
            let normalized_fraction = match fraction_raw.len() {
                0 => 0,
                1 => fraction_raw.parse::<i64>().ok()? * 100,
                2 => fraction_raw.parse::<i64>().ok()? * 10,
                _ => fraction_raw[..3.min(fraction_raw.len())]
                    .parse::<i64>()
                    .ok()?,
            };
            (seconds, normalized_fraction)
        } else {
            (seconds_raw.parse::<i64>().ok()?, 0)
        };

    Some(minutes * 60_000 + seconds * 1_000 + fractional_ms)
}

fn normalize_remote_url(url: &str) -> Option<String> {
    normalize_optional_text(Some(url.to_string())).map(|value| {
        if let Some(stripped) = value.strip_prefix("http://") {
            format!("https://{stripped}")
        } else {
            value
        }
    })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn fallback_label(value: &str, fallback: &str) -> String {
    normalize_optional_text(Some(value.to_string())).unwrap_or_else(|| fallback.to_string())
}

fn pick_accent_color(index: usize) -> String {
    SUMMARY_ACCENT_COLORS[index % SUMMARY_ACCENT_COLORS.len()].to_string()
}

fn no_store_json_response<T>(payload: T) -> Response
where
    T: Serialize,
{
    let mut response = Json(payload).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
