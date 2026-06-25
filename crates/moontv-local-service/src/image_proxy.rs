use axum::{
    extract::{Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, REFERER, USER_AGENT},
    },
    response::Response,
};
use serde::Deserialize;
use url::Url;

use crate::{AppError, AppResult, AppState};

const IMAGE_PROXY_CACHE_CONTROL: &str = "public, max-age=15720000, s-maxage=15720000";
const DOUBAN_IMAGE_REFERER: &str = "https://movie.douban.com/";

#[derive(Debug, Deserialize)]
pub(crate) struct ImageProxyQueryParams {
    url: Option<String>,
}

pub(crate) async fn get_image_proxy(
    State(state): State<AppState>,
    Query(params): Query<ImageProxyQueryParams>,
) -> AppResult<Response> {
    let image_url = require_image_proxy_url(params.url.as_deref())?;
    let upstream_response = state
        .client
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

    let status = upstream_response.status();
    let content_type = upstream_response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = upstream_response
        .bytes()
        .await
        .map_err(|error| {
            AppError::new(
                StatusCode::BAD_GATEWAY,
                format!("failed to read image response: {error}"),
            )
        })?
        .to_vec();

    let mut headers = HeaderMap::new();
    if let Ok(value) =
        HeaderValue::from_str(content_type.as_deref().unwrap_or("application/octet-stream"))
    {
        headers.insert(CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&body.len().to_string()) {
        headers.insert(CONTENT_LENGTH, value);
    }
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(IMAGE_PROXY_CACHE_CONTROL),
    );
    crate::apply_cors_headers(&mut headers);

    let mut response = Response::new(axum::body::Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}

fn require_image_proxy_url(value: Option<&str>) -> AppResult<Url> {
    let image_url = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::bad_request("Missing image URL"))?;

    Url::parse(image_url).map_err(|_| AppError::bad_request("Invalid image URL"))
}
