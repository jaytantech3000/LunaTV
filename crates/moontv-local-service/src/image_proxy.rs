use std::time::Duration;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, REFERER, USER_AGENT},
    },
    response::Response,
};
use futures::StreamExt;
use serde::Deserialize;
use url::Url;

use crate::{AppError, AppResult, AppState, image_cache::CachedImage};

const IMAGE_PROXY_CACHE_CONTROL: &str = "public, max-age=15720000, s-maxage=15720000";
const DOUBAN_IMAGE_REFERER: &str = "https://movie.douban.com/";
const IMAGE_PROXY_MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const IMAGE_PROXY_TIMEOUT: Duration = Duration::from_secs(10);
const ALLOWED_IMAGE_CONTENT_TYPES: &[&str] = &[
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
];

#[derive(Debug, Deserialize)]
pub(crate) struct ImageProxyQueryParams {
    url: Option<String>,
}

pub(crate) async fn get_image_proxy(
    State(state): State<AppState>,
    Query(params): Query<ImageProxyQueryParams>,
) -> AppResult<Response> {
    let image_url = require_image_proxy_url(params.url.as_deref())?;
    let image = get_or_fetch_image(&state, image_url).await?;
    Ok(image_response(image))
}

pub(crate) async fn get_or_fetch_image(state: &AppState, image_url: Url) -> AppResult<CachedImage> {
    let cache_key = image_url.as_str().to_string();
    if let Some(image) = state.read_cached_image(&cache_key)? {
        return Ok(image);
    }

    let (flight, completion_rx, is_leader) = state.acquire_image_flight(&cache_key).await;
    if !is_leader {
        let mut completion_rx =
            completion_rx.expect("image fetch follower has a completion receiver");
        return tokio::time::timeout_at(flight.deadline, async move {
            loop {
                if let Some(result) = completion_rx.borrow().clone() {
                    return result;
                }
                completion_rx.changed().await.map_err(|_| {
                    AppError::new(StatusCode::BAD_GATEWAY, "image fetch flight was cancelled")
                })?;
            }
        })
        .await
        .map_err(|_| AppError::new(StatusCode::GATEWAY_TIMEOUT, "image fetch timed out"))?;
    }

    let result = match fetch_image(state, image_url, flight.deadline).await {
        Ok(image) => state.write_cached_image(&cache_key, &image).map(|()| image),
        Err(error) => Err(error),
    };
    state
        .complete_image_flight(&cache_key, &flight, result.clone())
        .await;
    result
}

async fn fetch_image(
    state: &AppState,
    image_url: Url,
    deadline: tokio::time::Instant,
) -> AppResult<CachedImage> {
    tokio::time::timeout_at(deadline, async {
        let upstream_response = state
            .image_client
            .get(image_url)
            .header(REFERER, HeaderValue::from_static(DOUBAN_IMAGE_REFERER))
            .header(USER_AGENT, HeaderValue::from_static(crate::DEFAULT_WEB_UA))
            .send()
            .await
            .map_err(|error| {
                AppError::new(
                    StatusCode::BAD_GATEWAY,
                    format!("failed to fetch image: {error}"),
                )
            })?;
        read_image_response(upstream_response).await
    })
    .await
    .map_err(|_| AppError::new(StatusCode::GATEWAY_TIMEOUT, "image fetch timed out"))?
}

async fn read_image_response(upstream_response: reqwest::Response) -> AppResult<CachedImage> {
    if !upstream_response.status().is_success() {
        return Err(AppError::new(
            StatusCode::BAD_GATEWAY,
            format!("image upstream returned {}", upstream_response.status()),
        ));
    }

    let content_type = validated_image_content_type(upstream_response.headers())?;
    if let Some(content_length) = upstream_response.content_length()
        && content_length > IMAGE_PROXY_MAX_BODY_BYTES as u64
    {
        return Err(AppError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "image response exceeds 10 MiB limit",
        ));
    }

    let mut body = Vec::new();
    let mut stream = upstream_response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            AppError::new(
                StatusCode::BAD_GATEWAY,
                format!("failed to read image response: {error}"),
            )
        })?;
        if body.len().saturating_add(chunk.len()) > IMAGE_PROXY_MAX_BODY_BYTES {
            return Err(AppError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "image response exceeds 10 MiB limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(CachedImage { content_type, body })
}

fn validated_image_content_type(headers: &reqwest::header::HeaderMap) -> AppResult<String> {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .filter(|value| ALLOWED_IMAGE_CONTENT_TYPES.contains(&value.as_str()))
        .ok_or_else(|| {
            AppError::new(
                StatusCode::BAD_GATEWAY,
                "upstream response is not an allowed image type",
            )
        })?;
    Ok(content_type)
}

fn image_response(image: CachedImage) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&image.content_type).expect("validated image content type"),
    );
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&image.body.len().to_string()).expect("image body length header"),
    );
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(IMAGE_PROXY_CACHE_CONTROL),
    );
    crate::apply_cors_headers(&mut headers);

    let mut response = Response::new(Body::from(image.body));
    *response.status_mut() = StatusCode::OK;
    *response.headers_mut() = headers;
    response
}

fn require_image_proxy_url(value: Option<&str>) -> AppResult<Url> {
    let image_url = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::bad_request("Missing image URL"))?;
    let mut image_url =
        Url::parse(image_url).map_err(|_| AppError::bad_request("Invalid image URL"))?;
    let is_douban_image_host = image_url
        .host_str()
        .is_some_and(|host| host.ends_with(".doubanio.com"));

    if image_url.scheme() != "https"
        || !is_douban_image_host
        || !image_url.username().is_empty()
        || image_url.password().is_some()
    {
        return Err(AppError::bad_request(
            "Only HTTPS doubanio image URLs are allowed",
        ));
    }

    image_url.set_fragment(None);
    Ok(image_url)
}

#[cfg(test)]
mod tests {
    use super::require_image_proxy_url;

    #[test]
    fn only_accepts_https_doubanio_subdomains_without_credentials() {
        let normalized = require_image_proxy_url(Some(
            "https://img1.doubanio.com/view/photo/raw/public/p1.jpg#duplicate-cache-key",
        ))
        .expect("valid douban image URL");
        assert_eq!(
            normalized.as_str(),
            "https://img1.doubanio.com/view/photo/raw/public/p1.jpg"
        );
        assert!(require_image_proxy_url(Some("http://img1.doubanio.com/p1.jpg")).is_err());
        assert!(require_image_proxy_url(Some("https://doubanio.com/p1.jpg")).is_err());
        assert!(require_image_proxy_url(Some("https://example.com/p1.jpg")).is_err());
        assert!(
            require_image_proxy_url(Some("https://user:pass@img1.doubanio.com/p1.jpg")).is_err()
        );
    }

    #[test]
    fn only_allows_supported_image_content_types() {
        let valid = reqwest::header::HeaderMap::from_iter([(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("image/jpeg; charset=binary"),
        )]);
        let invalid = reqwest::header::HeaderMap::from_iter([(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("text/html"),
        )]);

        assert_eq!(
            super::validated_image_content_type(&valid).expect("valid image content type"),
            "image/jpeg"
        );
        assert!(super::validated_image_content_type(&invalid).is_err());
    }

    #[test]
    fn limits_image_bodies_to_ten_mebibytes() {
        assert_eq!(super::IMAGE_PROXY_MAX_BODY_BYTES, 10 * 1024 * 1024);
    }
}
