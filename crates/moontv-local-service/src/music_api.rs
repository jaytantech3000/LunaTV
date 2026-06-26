use std::io::Read;

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, Method, StatusCode,
        header::{
            ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, LOCATION, RANGE, REFERER, USER_AGENT,
        },
    },
    response::{IntoResponse, Response},
};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::{AppError, AppResult, AppState, DEFAULT_PROXY_TIMEOUT_MS};

const AUDIOUS_SOURCE_KEY: &str = "audius";
const AUDIOUS_SOURCE_NAME: &str = "Audius";
const AUDIOUS_APP_NAME: &str = "LunaTV";
const AUDIOUS_SOURCE_TABS: &[&str] = &["home", "hot", "playlist", "search"];
const JAMENDO_SOURCE_KEY: &str = "jamendo";
const JAMENDO_SOURCE_NAME: &str = "Jamendo";
const JAMENDO_SOURCE_TABS: &[&str] = &["home", "hot", "playlist", "search"];
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MusicProviderKey {
    Netease,
    Audius,
    Jamendo,
}

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
    code: Option<i64>,
    #[serde(default)]
    list: Vec<NeteaseToplist>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseToplist {
    id: i64,
    name: String,
    #[serde(default)]
    cover_img_url: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    track_count: usize,
    #[serde(default)]
    update_frequency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteasePersonalizedPlaylistResponse {
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
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
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
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
    #[serde(default)]
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    result: Option<NeteasePlaylistDetail>,
    #[serde(default)]
    playlist: Option<NeteasePlaylistDetail>,
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
    update_frequency: Option<String>,
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
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    songs: Vec<NeteaseSong>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeteaseSong {
    id: i64,
    name: String,
    #[serde(default)]
    fee: i64,
    #[serde(default, alias = "dt")]
    duration: u64,
    #[serde(default, alias = "ar")]
    artists: Vec<NeteaseArtist>,
    #[serde(default, alias = "al")]
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
    code: Option<i64>,
    #[serde(default)]
    lrc: Option<NeteaseLyricBlock>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    tlyric: Option<NeteaseLyricBlock>,
}

#[derive(Debug, Default, Deserialize)]
struct NeteaseLyricBlock {
    #[serde(default)]
    lyric: String,
}

#[derive(Debug, Deserialize)]
struct AudiusResponse<T> {
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusArtwork {
    #[serde(default, rename = "150x150")]
    size_150: Option<String>,
    #[serde(default, rename = "480x480")]
    size_480: Option<String>,
    #[serde(default, rename = "1000x1000")]
    size_1000: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusUser {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    handle: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusTrackAccess {
    #[serde(default)]
    stream: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusTrackStream {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusTrack {
    #[serde(default)]
    access: Option<AudiusTrackAccess>,
    #[serde(default)]
    artwork: Option<AudiusArtwork>,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    id: String,
    #[serde(default)]
    is_streamable: Option<bool>,
    #[serde(default)]
    stream: Option<AudiusTrackStream>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    user: Option<AudiusUser>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AudiusPlaylist {
    #[serde(default)]
    artwork: Option<AudiusArtwork>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    id: String,
    #[serde(default)]
    playlist_name: String,
    #[serde(default)]
    track_count: usize,
    #[serde(default)]
    tracks: Vec<AudiusTrack>,
    #[serde(default)]
    user: Option<AudiusUser>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct JamendoHeaders {
    #[serde(default)]
    error_message: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JamendoResponse<T> {
    #[serde(default)]
    headers: Option<JamendoHeaders>,
    #[serde(default)]
    results: Vec<T>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct JamendoTrack {
    #[serde(default)]
    album_id: Option<Value>,
    #[serde(default)]
    album_name: Option<String>,
    #[serde(default)]
    audio: Option<String>,
    #[serde(default)]
    audiodownload: Option<String>,
    #[serde(default)]
    artist_id: Option<Value>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct JamendoPlaylist {
    #[serde(default)]
    creationdate: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    track_count: Option<usize>,
    #[serde(default)]
    tracks: Vec<JamendoTrack>,
    #[serde(default)]
    user_name: Option<String>,
}

fn build_music_source_payload(
    key: &str,
    name: &str,
    enabled: bool,
    tabs: &[&str],
    description: &str,
) -> MusicSourcePayload {
    MusicSourcePayload {
        key: key.to_string(),
        name: name.to_string(),
        provider: key.to_string(),
        enabled,
        tabs: tabs.iter().map(|tab| (*tab).to_string()).collect(),
        description: Some(description.to_string()),
    }
}

fn is_jamendo_enabled(state: &AppState) -> bool {
    state
        .jamendo_client_id
        .as_ref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn resolve_music_source(source: Option<&str>) -> AppResult<MusicProviderKey> {
    let normalized = source.unwrap_or(NETEASE_SOURCE_KEY).trim();

    if normalized.is_empty() || normalized == NETEASE_SOURCE_KEY {
        return Ok(MusicProviderKey::Netease);
    }

    match normalized {
        AUDIOUS_SOURCE_KEY => Ok(MusicProviderKey::Audius),
        JAMENDO_SOURCE_KEY => Ok(MusicProviderKey::Jamendo),
        _ => Err(AppError::bad_request("Unsupported music source")),
    }
}

fn require_music_provider(
    state: &AppState,
    source: Option<&str>,
) -> AppResult<MusicProviderKey> {
    let provider = resolve_music_source(source)?;

    if provider == MusicProviderKey::Jamendo && !is_jamendo_enabled(state) {
        return Err(AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Jamendo 暂未开放",
        ));
    }

    Ok(provider)
}

pub(crate) async fn get_music_sources(State(state): State<AppState>) -> AppResult<Response> {
    Ok(no_store_json_response(MusicSourcesPayload {
        sources: vec![
            build_music_source_payload(
                NETEASE_SOURCE_KEY,
                NETEASE_SOURCE_NAME,
                true,
                MUSIC_SOURCE_TABS,
                "桌面本地模式已接入真实网易云公开数据。",
            ),
            build_music_source_payload(
                AUDIOUS_SOURCE_KEY,
                AUDIOUS_SOURCE_NAME,
                true,
                AUDIOUS_SOURCE_TABS,
                "桌面本地模式已接入 Audius 官方公开 API。",
            ),
            build_music_source_payload(
                JAMENDO_SOURCE_KEY,
                JAMENDO_SOURCE_NAME,
                is_jamendo_enabled(&state),
                JAMENDO_SOURCE_TABS,
                if is_jamendo_enabled(&state) {
                    "桌面本地模式已接入 Jamendo 官方公开 API。"
                } else {
                    "需要配置 JAMENDO_CLIENT_ID 后开放。"
                },
            ),
            build_music_source_payload(
                "qq",
                "QQ 音乐",
                false,
                DISABLED_MUSIC_SOURCE_TABS,
                "接入中，暂未开放。",
            ),
            build_music_source_payload(
                "kugou",
                "酷狗音乐",
                false,
                DISABLED_MUSIC_SOURCE_TABS,
                "接入中，暂未开放。",
            ),
        ],
    }))
}

pub(crate) async fn get_music_home(
    State(state): State<AppState>,
    Query(params): Query<MusicSourceQuery>,
) -> AppResult<Response> {
    match require_music_provider(&state, params.source.as_deref())? {
        MusicProviderKey::Netease => get_netease_music_home(&state).await,
        MusicProviderKey::Audius => get_audius_music_home(&state).await,
        MusicProviderKey::Jamendo => get_jamendo_music_home(&state).await,
    }
}

pub(crate) async fn get_music_search(
    State(state): State<AppState>,
    Query(params): Query<MusicSearchQuery>,
) -> AppResult<Response> {
    let query = params.q.unwrap_or_default().trim().to_string();
    let page = params.page.unwrap_or(1).max(1);

    match require_music_provider(&state, params.source.as_deref())? {
        MusicProviderKey::Netease => get_netease_music_search(&state, query, page).await,
        MusicProviderKey::Audius => get_audius_music_search(&state, query, page).await,
        MusicProviderKey::Jamendo => get_jamendo_music_search(&state, query, page).await,
    }
}

pub(crate) async fn get_music_collection(
    State(state): State<AppState>,
    Query(params): Query<MusicCollectionQuery>,
) -> AppResult<Response> {
    let collection_id = require_query_value(params.id.as_deref(), "Missing playlist id")?;

    match require_music_provider(&state, params.source.as_deref())? {
        MusicProviderKey::Netease => get_netease_music_collection(&state, &collection_id).await,
        MusicProviderKey::Audius => get_audius_music_collection(&state, &collection_id).await,
        MusicProviderKey::Jamendo => get_jamendo_music_collection(&state, &collection_id).await,
    }
}

pub(crate) async fn get_music_track(
    State(state): State<AppState>,
    Query(params): Query<MusicTrackQuery>,
) -> AppResult<Response> {
    let track_id = require_query_value(params.id.as_deref(), "Missing track id")?;
    let quality = normalize_optional_text(params.quality.clone()).unwrap_or_else(|| "standard".to_string());

    match require_music_provider(&state, params.source.as_deref())? {
        MusicProviderKey::Netease => get_netease_music_track(&state, &track_id, &quality).await,
        MusicProviderKey::Audius => get_audius_music_track(&state, &track_id, &quality).await,
        MusicProviderKey::Jamendo => get_jamendo_music_track(&state, &track_id, &quality).await,
    }
}

pub(crate) async fn get_music_lyric(
    State(state): State<AppState>,
    Query(params): Query<MusicTrackQuery>,
) -> AppResult<Response> {
    let track_id = require_query_value(params.id.as_deref(), "Missing track id")?;

    match require_music_provider(&state, params.source.as_deref())? {
        MusicProviderKey::Netease => get_netease_music_lyric(&state, &track_id).await,
        MusicProviderKey::Audius => get_empty_music_lyric_payload(AUDIOUS_SOURCE_KEY, track_id),
        MusicProviderKey::Jamendo => get_empty_music_lyric_payload(JAMENDO_SOURCE_KEY, track_id),
    }
}

fn get_empty_music_lyric_payload(source: &str, track_id: String) -> AppResult<Response> {
    Ok(no_store_json_response(MusicLyricPayload {
        track_id,
        source: source.to_string(),
        lines: Vec::new(),
        offset_ms: None,
    }))
}

async fn get_netease_music_home(state: &AppState) -> AppResult<Response> {
    let (toplists_result, playlists_result) = tokio::join!(
        fetch_netease_toplists(state),
        fetch_netease_recommended_playlists(state)
    );
    let toplists = match &toplists_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };
    let playlists = match &playlists_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };

    if toplists.is_empty() && playlists.is_empty() {
        if let Err(error) = toplists_result {
            return Err(error);
        }

        if let Err(error) = playlists_result {
            return Err(error);
        }
    }

    let spotlight = if let Some(first_toplist) = toplists.first() {
        match fetch_netease_playlist_detail(state, &first_toplist.id).await {
            Ok(playlist) => playlist
                .tracks
                .into_iter()
                .map(to_music_track_payload)
                .filter(|track| track.playable)
                .take(8)
                .collect(),
            Err(_) => Vec::new(),
        }
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
                fallback_label(item.update_frequency.as_deref(), "实时更新")
            )
        })
        .unwrap_or_else(|| "来自网易云公开榜单。".to_string());

    let mut sections = Vec::new();
    if !toplists.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "netease-rank".to_string(),
            title: "官方榜单".to_string(),
            tab: "rank".to_string(),
            kind: "collection-list".to_string(),
            description: Some("直接取自网易云公开榜单接口。".to_string()),
            collections: Some(rank_collections),
            tracks: None,
        });
        sections.push(MusicHomeSectionPayload {
            id: "netease-hot".to_string(),
            title: "热门单曲".to_string(),
            tab: "hot".to_string(),
            kind: "track-list".to_string(),
            description: Some(hot_description),
            collections: None,
            tracks: Some(spotlight),
        });
    }
    if !playlists.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "netease-playlist".to_string(),
            title: "推荐歌单".to_string(),
            tab: "playlist".to_string(),
            kind: "collection-list".to_string(),
            description: Some("来自网易云公开推荐歌单接口。".to_string()),
            collections: Some(playlist_collections),
            tracks: None,
        });
    }

    Ok(no_store_json_response(MusicHomePayload {
        source: NETEASE_SOURCE_KEY.to_string(),
        spotlight: sections
            .iter()
            .find(|section| section.id == "netease-hot")
            .and_then(|section| section.tracks.clone())
            .unwrap_or_default(),
        sections,
    }))
}

async fn get_netease_music_search(
    state: &AppState,
    query: String,
    page: usize,
) -> AppResult<Response> {
    if query.is_empty() {
        return Ok(no_store_json_response(MusicSearchPayload {
            source: NETEASE_SOURCE_KEY.to_string(),
            query,
            tracks: Vec::new(),
            collections: Vec::new(),
        }));
    }

    let (tracks, collections) = tokio::try_join!(
        fetch_netease_search_tracks(state, &query, page),
        fetch_netease_search_playlists(state, &query, page),
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

async fn get_netease_music_collection(
    state: &AppState,
    playlist_id: &str,
) -> AppResult<Response> {
    let playlist = fetch_netease_playlist_detail(
        state,
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
        updated_at_label: normalize_optional_text(playlist.update_frequency),
    }))
}

async fn get_netease_music_track(
    state: &AppState,
    track_id: &str,
    quality: &str,
) -> AppResult<Response> {
    let song = fetch_netease_song_detail(
        state,
        &track_id
            .parse()
            .map_err(|_| AppError::bad_request("Invalid track id"))?,
    )
    .await?;
    let track = to_music_track_payload(song);

    if !track.playable {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "当前曲目受版权或会员限制，暂不可播放",
        ));
    }

    Ok(no_store_json_response(MusicTrackDetailPayload {
        track,
        stream_url: format!(
            "/media/audio/stream?source={NETEASE_SOURCE_KEY}&id={track_id}&quality={quality}"
        ),
        quality: quality.to_string(),
    }))
}

async fn get_netease_music_lyric(state: &AppState, track_id: &str) -> AppResult<Response> {
    let lyric = fetch_netease_lyric(
        state,
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
        track_id: track_id.to_string(),
        source: NETEASE_SOURCE_KEY.to_string(),
        lines,
        offset_ms: None,
    }))
}

fn resolve_audius_artwork_url(artwork: Option<&AudiusArtwork>) -> Option<String> {
    artwork
        .and_then(|artwork| {
            normalize_optional_text(artwork.size_1000.clone())
                .or_else(|| normalize_optional_text(artwork.size_480.clone()))
                .or_else(|| normalize_optional_text(artwork.size_150.clone()))
        })
        .and_then(|value| normalize_remote_url(&value))
}

fn resolve_audius_artist_name(track: &AudiusTrack) -> String {
    track
        .user
        .as_ref()
        .and_then(|user| normalize_optional_text(user.name.clone()))
        .or_else(|| {
            track
                .user
                .as_ref()
                .and_then(|user| normalize_optional_text(user.handle.clone()))
        })
        .unwrap_or_else(|| "未知歌手".to_string())
}

fn resolve_audius_stream_url(state: &AppState, track: &AudiusTrack) -> Option<String> {
    track
        .stream
        .as_ref()
        .and_then(|stream| stream.url.clone())
        .and_then(|value| normalize_remote_url(&value))
        .or_else(|| {
            let track_id = normalize_optional_text(Some(track.id.clone()))?;
            Some(format!(
                "{}/v1/tracks/{track_id}/stream?app_name={AUDIOUS_APP_NAME}",
                state.audius_api_base_url.trim_end_matches('/')
            ))
        })
}

fn is_audius_track_playable(state: &AppState, track: &AudiusTrack) -> bool {
    if track
        .access
        .as_ref()
        .and_then(|access| access.stream)
        == Some(false)
    {
        return false;
    }

    if track.is_streamable == Some(false) {
        return false;
    }

    resolve_audius_stream_url(state, track).is_some()
}

fn to_audius_music_track_payload(state: &AppState, track: &AudiusTrack) -> MusicTrackPayload {
    let artist_name = resolve_audius_artist_name(track);

    MusicTrackPayload {
        id: track.id.clone(),
        source: AUDIOUS_SOURCE_KEY.to_string(),
        title: fallback_label(Some(track.title.as_str()), "未知曲目"),
        artists: vec![MusicArtistPayload {
            id: track.user.as_ref().and_then(|user| user.id.clone()),
            name: artist_name,
        }],
        album: None,
        cover: resolve_audius_artwork_url(track.artwork.as_ref()),
        duration_ms: (track.duration > 0).then_some(track.duration * 1_000),
        playable: is_audius_track_playable(state, track),
        subtitle: normalize_optional_text(track.genre.clone()),
    }
}

fn to_audius_playlist_summary(
    playlist: &AudiusPlaylist,
    index: usize,
) -> MusicCollectionSummaryPayload {
    MusicCollectionSummaryPayload {
        id: playlist.id.clone(),
        source: AUDIOUS_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: fallback_label(Some(playlist.playlist_name.as_str()), "Audius 歌单"),
        cover: resolve_audius_artwork_url(playlist.artwork.as_ref()),
        description: normalize_optional_text(playlist.description.clone()).or_else(|| {
            playlist
                .user
                .as_ref()
                .and_then(|user| normalize_optional_text(user.name.clone()))
        }),
        track_count: Some(playlist.track_count),
        accent_color: Some(pick_accent_color(index)),
    }
}

async fn fetch_audius_json<T>(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
    fallback: &str,
) -> AppResult<T>
where
    T: DeserializeOwned,
{
    let response = state
        .client
        .get(format!("{}{}", state.audius_api_base_url.trim_end_matches('/'), path))
        .query(query)
        .query(&[("app_name", AUDIOUS_APP_NAME)])
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, format!("{fallback}: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::new(StatusCode::BAD_GATEWAY, fallback));
    }

    response
        .json::<T>()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, format!("{fallback}: {error}")))
}

async fn fetch_audius_trending_tracks(state: &AppState) -> AppResult<Vec<AudiusTrack>> {
    let payload = fetch_audius_json::<AudiusResponse<Vec<AudiusTrack>>>(
        state,
        "/v1/tracks/trending",
        &[("limit", HOME_PLAYLIST_LIMIT.max(HOME_TOPLIST_LIMIT).to_string())],
        "获取 Audius 热门曲目失败",
    )
    .await?;

    Ok(payload.data.unwrap_or_default())
}

async fn fetch_audius_trending_playlists(state: &AppState) -> AppResult<Vec<AudiusPlaylist>> {
    let payload = fetch_audius_json::<AudiusResponse<Vec<AudiusPlaylist>>>(
        state,
        "/v1/playlists/trending",
        &[("limit", HOME_PLAYLIST_LIMIT.to_string())],
        "获取 Audius 热门歌单失败",
    )
    .await?;

    Ok(payload.data.unwrap_or_default())
}

async fn fetch_audius_search_tracks(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<AudiusTrack>> {
    let offset = page.saturating_sub(1) * SEARCH_TRACK_LIMIT;
    let payload = fetch_audius_json::<AudiusResponse<Vec<AudiusTrack>>>(
        state,
        "/v1/tracks/search",
        &[
            ("query", query.to_string()),
            ("limit", SEARCH_TRACK_LIMIT.to_string()),
            ("offset", offset.to_string()),
        ],
        "搜索 Audius 曲目失败",
    )
    .await?;

    Ok(payload.data.unwrap_or_default())
}

async fn fetch_audius_search_playlists(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<AudiusPlaylist>> {
    let offset = page.saturating_sub(1) * SEARCH_PLAYLIST_LIMIT;
    let payload = fetch_audius_json::<AudiusResponse<Vec<AudiusPlaylist>>>(
        state,
        "/v1/playlists/search",
        &[
            ("query", query.to_string()),
            ("limit", SEARCH_PLAYLIST_LIMIT.to_string()),
            ("offset", offset.to_string()),
        ],
        "搜索 Audius 歌单失败",
    )
    .await?;

    Ok(payload.data.unwrap_or_default())
}

async fn fetch_audius_playlist_detail(
    state: &AppState,
    playlist_id: &str,
) -> AppResult<AudiusPlaylist> {
    let payload = fetch_audius_json::<AudiusResponse<Vec<AudiusPlaylist>>>(
        state,
        &format!("/v1/playlists/{playlist_id}"),
        &[],
        "获取 Audius 歌单详情失败",
    )
    .await?;

    payload
        .data
        .unwrap_or_default()
        .into_iter()
        .next()
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "合集不存在"))
}

async fn fetch_audius_track_detail(state: &AppState, track_id: &str) -> AppResult<AudiusTrack> {
    let payload = fetch_audius_json::<AudiusResponse<AudiusTrack>>(
        state,
        &format!("/v1/tracks/{track_id}"),
        &[],
        "获取 Audius 曲目信息失败",
    )
    .await?;

    payload
        .data
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "曲目不存在"))
}

async fn get_audius_music_home(state: &AppState) -> AppResult<Response> {
    let (tracks_result, playlists_result) = tokio::join!(
        fetch_audius_trending_tracks(state),
        fetch_audius_trending_playlists(state)
    );
    let tracks = match &tracks_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };
    let playlists = match &playlists_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };

    if tracks.is_empty() && playlists.is_empty() {
        if let Err(error) = tracks_result {
            return Err(error);
        }

        if let Err(error) = playlists_result {
            return Err(error);
        }
    }

    let spotlight = tracks
        .iter()
        .take(HOME_TOPLIST_LIMIT.max(HOME_PLAYLIST_LIMIT))
        .map(|track| to_audius_music_track_payload(state, track))
        .filter(|track| track.playable)
        .collect::<Vec<_>>();

    let mut sections = Vec::new();
    if !tracks.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "audius-hot".to_string(),
            title: "热门单曲".to_string(),
            tab: "hot".to_string(),
            kind: "track-list".to_string(),
            description: Some("来自 Audius Trending Tracks。".to_string()),
            collections: None,
            tracks: Some(spotlight.clone()),
        });
    }
    if !playlists.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "audius-playlist".to_string(),
            title: "热门歌单".to_string(),
            tab: "playlist".to_string(),
            kind: "collection-list".to_string(),
            description: Some("来自 Audius Trending Playlists。".to_string()),
            collections: Some(
                playlists
                    .iter()
                    .take(HOME_PLAYLIST_LIMIT)
                    .enumerate()
                    .map(|(index, item)| to_audius_playlist_summary(item, index))
                    .collect(),
            ),
            tracks: None,
        });
    }

    Ok(no_store_json_response(MusicHomePayload {
        source: AUDIOUS_SOURCE_KEY.to_string(),
        spotlight,
        sections,
    }))
}

async fn get_audius_music_search(
    state: &AppState,
    query: String,
    page: usize,
) -> AppResult<Response> {
    if query.is_empty() {
        return Ok(no_store_json_response(MusicSearchPayload {
            source: AUDIOUS_SOURCE_KEY.to_string(),
            query,
            tracks: Vec::new(),
            collections: Vec::new(),
        }));
    }

    let (tracks, collections) = tokio::try_join!(
        fetch_audius_search_tracks(state, &query, page),
        fetch_audius_search_playlists(state, &query, page),
    )?;

    Ok(no_store_json_response(MusicSearchPayload {
        source: AUDIOUS_SOURCE_KEY.to_string(),
        query,
        tracks: tracks
            .iter()
            .take(SEARCH_TRACK_LIMIT)
            .map(|track| to_audius_music_track_payload(state, track))
            .collect(),
        collections: collections
            .iter()
            .take(SEARCH_PLAYLIST_LIMIT)
            .enumerate()
            .map(|(index, item)| to_audius_playlist_summary(item, index))
            .collect(),
    }))
}

async fn get_audius_music_collection(
    state: &AppState,
    playlist_id: &str,
) -> AppResult<Response> {
    let playlist = fetch_audius_playlist_detail(state, playlist_id).await?;

    Ok(no_store_json_response(MusicCollectionPayload {
        id: playlist.id.clone(),
        source: AUDIOUS_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: fallback_label(Some(playlist.playlist_name.as_str()), "Audius 歌单"),
        cover: resolve_audius_artwork_url(playlist.artwork.as_ref()),
        description: normalize_optional_text(playlist.description.clone()),
        track_count: Some(if playlist.track_count > 0 {
            playlist.track_count
        } else {
            playlist.tracks.len()
        }),
        accent_color: Some(SUMMARY_ACCENT_COLORS[0].to_string()),
        tracks: playlist
            .tracks
            .iter()
            .map(|track| to_audius_music_track_payload(state, track))
            .collect(),
        curator: playlist
            .user
            .as_ref()
            .and_then(|user| normalize_optional_text(user.name.clone())),
        updated_at_label: None,
    }))
}

async fn get_audius_music_track(
    state: &AppState,
    track_id: &str,
    quality: &str,
) -> AppResult<Response> {
    let track = fetch_audius_track_detail(state, track_id).await?;
    let payload = to_audius_music_track_payload(state, &track);
    let stream_url = resolve_audius_stream_url(state, &track)
        .ok_or_else(|| AppError::new(StatusCode::FORBIDDEN, "当前曲目暂不可播放"))?;

    if !payload.playable {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "当前曲目暂不可播放",
        ));
    }

    Ok(no_store_json_response(MusicTrackDetailPayload {
        track: payload,
        stream_url,
        quality: quality.to_string(),
    }))
}

fn jamendo_id_to_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(inner)) => normalize_optional_text(Some(inner.clone())),
        Some(Value::Number(inner)) => Some(inner.to_string()),
        _ => None,
    }
}

fn resolve_jamendo_audio_url(track: &JamendoTrack) -> Option<String> {
    track
        .audio
        .clone()
        .and_then(|value| normalize_remote_url(&value))
        .or_else(|| {
            track.audiodownload
                .clone()
                .and_then(|value| normalize_remote_url(&value))
        })
}

fn to_jamendo_music_track_payload(track: &JamendoTrack) -> MusicTrackPayload {
    let cover = track
        .image
        .clone()
        .and_then(|value| normalize_remote_url(&value));
    let album_title = normalize_optional_text(track.album_name.clone());

    MusicTrackPayload {
        id: jamendo_id_to_string(track.id.as_ref()).unwrap_or_default(),
        source: JAMENDO_SOURCE_KEY.to_string(),
        title: fallback_label(track.name.as_deref(), "未知曲目"),
        artists: vec![MusicArtistPayload {
            id: jamendo_id_to_string(track.artist_id.as_ref()),
            name: fallback_label(track.artist_name.as_deref(), "未知歌手"),
        }],
        album: album_title.clone().map(|title| MusicAlbumPayload {
            id: jamendo_id_to_string(track.album_id.as_ref()),
            title,
            cover: cover.clone(),
        }),
        cover,
        duration_ms: track.duration.map(|duration| duration * 1_000),
        playable: resolve_jamendo_audio_url(track).is_some(),
        subtitle: album_title,
    }
}

fn to_jamendo_playlist_summary(
    playlist: &JamendoPlaylist,
    index: usize,
) -> MusicCollectionSummaryPayload {
    MusicCollectionSummaryPayload {
        id: jamendo_id_to_string(playlist.id.as_ref()).unwrap_or_default(),
        source: JAMENDO_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: fallback_label(playlist.name.as_deref(), "Jamendo 歌单"),
        cover: playlist
            .image
            .clone()
            .and_then(|value| normalize_remote_url(&value)),
        description: normalize_optional_text(playlist.user_name.clone())
            .or_else(|| normalize_optional_text(playlist.creationdate.clone())),
        track_count: playlist.track_count,
        accent_color: Some(pick_accent_color(index)),
    }
}

fn ensure_jamendo_success(headers: Option<&JamendoHeaders>, fallback: &str) -> AppResult<()> {
    if let Some(status) = headers.and_then(|headers| headers.status.as_deref()) {
        if !status.eq_ignore_ascii_case("success") {
            return Err(AppError::new(
                StatusCode::BAD_GATEWAY,
                headers
                    .and_then(|headers| headers.error_message.clone())
                    .unwrap_or_else(|| fallback.to_string()),
            ));
        }
    }

    Ok(())
}

async fn fetch_jamendo_json<T>(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
    fallback: &str,
) -> AppResult<JamendoResponse<T>>
where
    T: DeserializeOwned + Default,
{
    let client_id = state
        .jamendo_client_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::new(StatusCode::SERVICE_UNAVAILABLE, "Jamendo 暂未开放"))?;

    let response = state
        .client
        .get(format!("{}{}", state.jamendo_api_base_url.trim_end_matches('/'), path))
        .query(query)
        .query(&[
            ("client_id", client_id),
            ("format", "json".to_string()),
        ])
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, format!("{fallback}: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::new(StatusCode::BAD_GATEWAY, fallback));
    }

    let payload = response
        .json::<JamendoResponse<T>>()
        .await
        .map_err(|error| AppError::new(StatusCode::BAD_GATEWAY, format!("{fallback}: {error}")))?;
    ensure_jamendo_success(payload.headers.as_ref(), fallback)?;
    Ok(payload)
}

async fn fetch_jamendo_home_tracks(state: &AppState) -> AppResult<Vec<JamendoTrack>> {
    Ok(
        fetch_jamendo_json::<JamendoTrack>(
            state,
            "/tracks/",
            &[
                ("audioformat", "mp32".to_string()),
                ("featured", "1".to_string()),
                ("limit", HOME_TOPLIST_LIMIT.max(HOME_PLAYLIST_LIMIT).to_string()),
                ("order", "popularity_total".to_string()),
            ],
            "获取 Jamendo 热门曲目失败",
        )
        .await?
        .results,
    )
}

async fn fetch_jamendo_playlists(state: &AppState) -> AppResult<Vec<JamendoPlaylist>> {
    Ok(
        fetch_jamendo_json::<JamendoPlaylist>(
            state,
            "/playlists/",
            &[
                ("limit", HOME_PLAYLIST_LIMIT.to_string()),
                ("order", "popularity_total".to_string()),
            ],
            "获取 Jamendo 热门歌单失败",
        )
        .await?
        .results,
    )
}

async fn fetch_jamendo_search_tracks(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<JamendoTrack>> {
    let offset = page.saturating_sub(1) * SEARCH_TRACK_LIMIT;
    Ok(
        fetch_jamendo_json::<JamendoTrack>(
            state,
            "/tracks/",
            &[
                ("audioformat", "mp32".to_string()),
                ("limit", SEARCH_TRACK_LIMIT.to_string()),
                ("offset", offset.to_string()),
                ("order", "popularity_total".to_string()),
                ("search", query.to_string()),
            ],
            "搜索 Jamendo 曲目失败",
        )
        .await?
        .results,
    )
}

async fn fetch_jamendo_search_playlists(
    state: &AppState,
    query: &str,
    page: usize,
) -> AppResult<Vec<JamendoPlaylist>> {
    let offset = page.saturating_sub(1) * SEARCH_PLAYLIST_LIMIT;
    Ok(
        fetch_jamendo_json::<JamendoPlaylist>(
            state,
            "/playlists/",
            &[
                ("limit", SEARCH_PLAYLIST_LIMIT.to_string()),
                ("namesearch", query.to_string()),
                ("offset", offset.to_string()),
                ("order", "popularity_total".to_string()),
            ],
            "搜索 Jamendo 歌单失败",
        )
        .await?
        .results,
    )
}

async fn fetch_jamendo_playlist_detail(
    state: &AppState,
    playlist_id: &str,
) -> AppResult<JamendoPlaylist> {
    fetch_jamendo_json::<JamendoPlaylist>(
        state,
        "/playlists/tracks/",
        &[
            ("audioformat", "mp32".to_string()),
            ("id", playlist_id.to_string()),
        ],
        "获取 Jamendo 歌单详情失败",
    )
    .await?
    .results
    .into_iter()
    .next()
    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "合集不存在"))
}

async fn fetch_jamendo_track_detail(state: &AppState, track_id: &str) -> AppResult<JamendoTrack> {
    fetch_jamendo_json::<JamendoTrack>(
        state,
        "/tracks/",
        &[
            ("audioformat", "mp32".to_string()),
            ("id", track_id.to_string()),
        ],
        "获取 Jamendo 曲目信息失败",
    )
    .await?
    .results
    .into_iter()
    .next()
    .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "曲目不存在"))
}

async fn get_jamendo_music_home(state: &AppState) -> AppResult<Response> {
    let (tracks_result, playlists_result) =
        tokio::join!(fetch_jamendo_home_tracks(state), fetch_jamendo_playlists(state));
    let tracks = match &tracks_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };
    let playlists = match &playlists_result {
        Ok(value) => value.clone(),
        Err(_) => Vec::new(),
    };

    if tracks.is_empty() && playlists.is_empty() {
        if let Err(error) = tracks_result {
            return Err(error);
        }

        if let Err(error) = playlists_result {
            return Err(error);
        }
    }

    let spotlight = tracks
        .iter()
        .take(HOME_TOPLIST_LIMIT.max(HOME_PLAYLIST_LIMIT))
        .map(to_jamendo_music_track_payload)
        .filter(|track| track.playable)
        .collect::<Vec<_>>();

    let mut sections = Vec::new();
    if !tracks.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "jamendo-hot".to_string(),
            title: "精选单曲".to_string(),
            tab: "hot".to_string(),
            kind: "track-list".to_string(),
            description: Some("来自 Jamendo 公开曲库。".to_string()),
            collections: None,
            tracks: Some(spotlight.clone()),
        });
    }
    if !playlists.is_empty() {
        sections.push(MusicHomeSectionPayload {
            id: "jamendo-playlist".to_string(),
            title: "精选歌单".to_string(),
            tab: "playlist".to_string(),
            kind: "collection-list".to_string(),
            description: Some("来自 Jamendo 公开歌单。".to_string()),
            collections: Some(
                playlists
                    .iter()
                    .take(HOME_PLAYLIST_LIMIT)
                    .enumerate()
                    .map(|(index, item)| to_jamendo_playlist_summary(item, index))
                    .collect(),
            ),
            tracks: None,
        });
    }

    Ok(no_store_json_response(MusicHomePayload {
        source: JAMENDO_SOURCE_KEY.to_string(),
        spotlight,
        sections,
    }))
}

async fn get_jamendo_music_search(
    state: &AppState,
    query: String,
    page: usize,
) -> AppResult<Response> {
    if query.is_empty() {
        return Ok(no_store_json_response(MusicSearchPayload {
            source: JAMENDO_SOURCE_KEY.to_string(),
            query,
            tracks: Vec::new(),
            collections: Vec::new(),
        }));
    }

    let (tracks, collections) = tokio::try_join!(
        fetch_jamendo_search_tracks(state, &query, page),
        fetch_jamendo_search_playlists(state, &query, page),
    )?;

    Ok(no_store_json_response(MusicSearchPayload {
        source: JAMENDO_SOURCE_KEY.to_string(),
        query,
        tracks: tracks
            .iter()
            .take(SEARCH_TRACK_LIMIT)
            .map(to_jamendo_music_track_payload)
            .collect(),
        collections: collections
            .iter()
            .take(SEARCH_PLAYLIST_LIMIT)
            .enumerate()
            .map(|(index, item)| to_jamendo_playlist_summary(item, index))
            .collect(),
    }))
}

async fn get_jamendo_music_collection(
    state: &AppState,
    playlist_id: &str,
) -> AppResult<Response> {
    let playlist = fetch_jamendo_playlist_detail(state, playlist_id).await?;

    Ok(no_store_json_response(MusicCollectionPayload {
        id: jamendo_id_to_string(playlist.id.as_ref()).unwrap_or_else(|| playlist_id.to_string()),
        source: JAMENDO_SOURCE_KEY.to_string(),
        kind: "playlist".to_string(),
        title: fallback_label(playlist.name.as_deref(), "Jamendo 歌单"),
        cover: playlist
            .image
            .clone()
            .and_then(|value| normalize_remote_url(&value)),
        description: normalize_optional_text(playlist.creationdate.clone()),
        track_count: playlist.track_count.or_else(|| Some(playlist.tracks.len())),
        accent_color: Some(SUMMARY_ACCENT_COLORS[0].to_string()),
        tracks: playlist
            .tracks
            .iter()
            .map(to_jamendo_music_track_payload)
            .collect(),
        curator: normalize_optional_text(playlist.user_name.clone()),
        updated_at_label: None,
    }))
}

async fn get_jamendo_music_track(
    state: &AppState,
    track_id: &str,
    quality: &str,
) -> AppResult<Response> {
    let track = fetch_jamendo_track_detail(state, track_id).await?;
    let payload = to_jamendo_music_track_payload(&track);
    let stream_url = resolve_jamendo_audio_url(&track)
        .ok_or_else(|| AppError::new(StatusCode::FORBIDDEN, "当前曲目暂不可播放"))?;

    if !payload.playable {
        return Err(AppError::new(
            StatusCode::FORBIDDEN,
            "当前曲目暂不可播放",
        ));
    }

    Ok(no_store_json_response(MusicTrackDetailPayload {
        track: payload,
        stream_url,
        quality: quality.to_string(),
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
    let payload = fetch_netease_json::<NeteaseToplistResponse>(state, "/api/toplist", &[]).await?;
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "获取榜单失败",
    )?;
    Ok(payload.list)
}

async fn fetch_netease_recommended_playlists(
    state: &AppState,
) -> AppResult<Vec<NeteasePlaylistRecommendation>> {
    let payload = fetch_netease_json::<NeteasePersonalizedPlaylistResponse>(
        state,
        "/api/personalized/playlist",
        &[("limit", HOME_PLAYLIST_LIMIT.to_string())],
    )
    .await?;
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "获取推荐歌单失败",
    )?;
    Ok(payload.result)
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
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "搜索曲目失败",
    )?;
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
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "搜索歌单失败",
    )?;
    Ok(payload.result.unwrap_or_default().playlists)
}

async fn fetch_netease_playlist_detail(
    state: &AppState,
    playlist_id: &i64,
) -> AppResult<NeteasePlaylistDetail> {
    let payload = fetch_netease_json::<NeteasePlaylistDetailResponse>(
        state,
        "/api/v3/playlist/detail",
        &[("id", playlist_id.to_string())],
    )
    .await?;
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "获取歌单详情失败",
    )?;
    payload
        .playlist
        .or(payload.result)
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "合集不存在"))
}

async fn fetch_netease_song_detail(state: &AppState, track_id: &i64) -> AppResult<NeteaseSong> {
    let payload = fetch_netease_json::<NeteaseSongDetailResponse>(
        state,
        "/api/song/detail",
        &[("ids", format!("[{track_id}]"))],
    )
    .await?;
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "获取曲目信息失败",
    )?;
    payload
        .songs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::new(StatusCode::NOT_FOUND, "Track not found"))
}

async fn fetch_netease_lyric(state: &AppState, track_id: &i64) -> AppResult<NeteaseLyricResponse> {
    let payload = fetch_netease_json::<NeteaseLyricResponse>(
        state,
        "/api/song/lyric",
        &[
            ("id", track_id.to_string()),
            ("lv", "-1".to_string()),
            ("tv", "-1".to_string()),
        ],
    )
    .await?;
    ensure_netease_success(
        payload.code,
        payload.msg.as_deref(),
        payload.message.as_deref(),
        "获取歌词失败",
    )?;
    Ok(payload)
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
        .headers(build_netease_request_headers(None, false, None))
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
        .headers(build_netease_request_headers(Some(request_headers), true, None))
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
    let response = state
        .no_decode_client
        .get(build_netease_endpoint(&state.netease_api_base_url, path))
        .query(query)
        .headers(build_netease_request_headers(None, false, Some("gzip")))
        .timeout(std::time::Duration::from_millis(DEFAULT_PROXY_TIMEOUT_MS))
        .send()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let content_encoding = response
        .headers()
        .get(CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .bytes()
        .await
        .map_err(|error| AppError::internal(error.to_string()))?;
    let decoded_body = decode_netease_json_body(
        path,
        content_encoding.as_deref(),
        body.as_ref(),
    )?;

    let payload = serde_json::from_slice::<serde_json::Value>(&decoded_body).map_err(|error| {
        tracing::warn!(%path, ?error, "failed to parse netease json payload");
        AppError::internal("音乐上游响应解析失败")
    })?;

    serde_json::from_value::<T>(payload).map_err(|error| {
        tracing::warn!(%path, ?error, "failed to deserialize netease json payload");
        AppError::internal("音乐上游响应解析失败")
    })
}

fn decode_netease_json_body(
    path: &str,
    content_encoding: Option<&str>,
    body: &[u8],
) -> AppResult<Vec<u8>> {
    match content_encoding
        .map(str::trim)
        .filter(|encoding| !encoding.is_empty())
    {
        None | Some("identity") => Ok(body.to_vec()),
        Some("gzip") => {
            let mut decoder = GzDecoder::new(body);
            let mut decoded = Vec::new();
            decoder.read_to_end(&mut decoded).map_err(|error| {
                tracing::warn!(%path, encoding = "gzip", ?error, "failed to decode netease gzip body");
                AppError::internal("音乐上游响应解析失败")
            })?;
            Ok(decoded)
        }
        Some(other) => {
            tracing::warn!(%path, encoding = other, "unsupported netease content encoding");
            Err(AppError::internal("音乐上游响应解析失败"))
        }
    }
}

fn build_netease_request_headers(
    request_headers: Option<&HeaderMap>,
    include_range: bool,
    accept_encoding: Option<&'static str>,
) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(crate::DEFAULT_WEB_UA));
    headers.insert(REFERER, HeaderValue::from_static(NETEASE_REFERER));
    if let Some(accept_encoding) = accept_encoding {
        // Some Netease JSON endpoints return Brotli payloads that curl/undici can decode
        // but reqwest fails on intermittently, so keep JSON fetches on gzip only.
        headers.insert(ACCEPT_ENCODING, HeaderValue::from_static(accept_encoding));
    }

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
        description: normalize_optional_text(item.description.clone()),
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
    let playable = is_netease_track_playable(&song);
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
        playable,
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

fn resolve_netease_error_status(code: Option<i64>) -> StatusCode {
    if code == Some(-110) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::BAD_GATEWAY
    }
}

fn resolve_netease_error_message(
    msg: Option<&str>,
    message: Option<&str>,
    fallback: &str,
) -> String {
    normalize_optional_text(message.map(str::to_string))
        .or_else(|| normalize_optional_text(msg.map(str::to_string)))
        .unwrap_or_else(|| fallback.to_string())
}

fn ensure_netease_success(
    code: Option<i64>,
    msg: Option<&str>,
    message: Option<&str>,
    fallback: &str,
) -> AppResult<()> {
    if matches!(code, Some(200) | None) {
        return Ok(());
    }

    Err(AppError::new(
        resolve_netease_error_status(code),
        resolve_netease_error_message(msg, message, fallback),
    ))
}

fn is_netease_track_playable(song: &NeteaseSong) -> bool {
    song.fee == 0
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn fallback_label(value: Option<&str>, fallback: &str) -> String {
    normalize_optional_text(value.map(str::to_string)).unwrap_or_else(|| fallback.to_string())
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
