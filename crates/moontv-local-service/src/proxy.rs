use crate::config::{ApiSiteConfig, LiveSourceConfig};
use reqwest::{
    Client, Method, Response,
    header::{self, HeaderMap, HeaderValue},
    redirect::Policy,
};
use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{net::lookup_host, sync::Mutex, time::timeout};
use url::Url;

const DNS_LOOKUP_TIMEOUT: Duration = Duration::from_secs(4);
const HOST_CACHE_TTL: Duration = Duration::from_secs(60);
const MAX_REDIRECTS: usize = 3;

pub type SharedValidatedHosts = Arc<Mutex<HashMap<String, Instant>>>;

#[derive(Clone, Debug)]
pub struct ProxySupport {
    allow_private_hosts: bool,
    client: Client,
    validated_hosts: SharedValidatedHosts,
}

#[derive(Debug)]
pub enum ProxyFetchError {
    InvalidTarget(String),
    Upstream(String),
}

impl ProxySupport {
    pub fn new(allow_private_hosts: bool) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(30))
            .user_agent("LunaTV Local Service")
            .build()?;

        Ok(Self {
            allow_private_hosts,
            client,
            validated_hosts: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn fetch(
        &self,
        raw_url: &str,
        method: Method,
        headers: HeaderMap,
    ) -> Result<Response, ProxyFetchError> {
        let mut current = self.validate_target_url(raw_url).await?;

        for _ in 0..=MAX_REDIRECTS {
            let response = self
                .client
                .request(method.clone(), current.clone())
                .headers(headers.clone())
                .send()
                .await
                .map_err(|error| ProxyFetchError::Upstream(error.to_string()))?;

            if response.status().is_redirection() {
                let Some(location) = response.headers().get(header::LOCATION) else {
                    return Err(ProxyFetchError::Upstream(
                        "redirect location missing".to_string(),
                    ));
                };
                let location = location.to_str().map_err(|_| {
                    ProxyFetchError::Upstream("invalid redirect location".to_string())
                })?;
                let next = current.join(location).map_err(|_| {
                    ProxyFetchError::InvalidTarget("invalid redirect url".to_string())
                })?;
                current = self.validate_target_url(next.as_str()).await?;
                continue;
            }

            return Ok(response);
        }

        Err(ProxyFetchError::Upstream("too many redirects".to_string()))
    }

    async fn validate_target_url(&self, raw_url: &str) -> Result<Url, ProxyFetchError> {
        let parsed = Url::parse(raw_url)
            .map_err(|_| ProxyFetchError::InvalidTarget("invalid url".to_string()))?;

        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(ProxyFetchError::InvalidTarget(
                "only http/https supported".to_string(),
            ));
        }

        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(ProxyFetchError::InvalidTarget(
                "url credentials are not supported".to_string(),
            ));
        }

        if self.allow_private_hosts {
            return Ok(parsed);
        }

        let hostname = normalize_hostname(parsed.host_str().unwrap_or_default());
        if is_blocked_hostname(&hostname) {
            return Err(ProxyFetchError::InvalidTarget("blocked host".to_string()));
        }

        if let Ok(ip) = hostname.parse::<IpAddr>() {
            if is_blocked_address(ip) {
                return Err(ProxyFetchError::InvalidTarget(
                    "blocked ip address".to_string(),
                ));
            }
            return Ok(parsed);
        }

        self.validate_resolvable_hostname(&hostname).await?;
        Ok(parsed)
    }

    async fn validate_resolvable_hostname(&self, hostname: &str) -> Result<(), ProxyFetchError> {
        {
            let cache = self.validated_hosts.lock().await;
            if let Some(expires_at) = cache.get(hostname) {
                if *expires_at > Instant::now() {
                    return Ok(());
                }
            }
        }

        let lookup = timeout(DNS_LOOKUP_TIMEOUT, lookup_host((hostname, 80)))
            .await
            .map_err(|_| {
                ProxyFetchError::InvalidTarget(format!("host lookup timed out: {hostname}"))
            })?
            .map_err(|error| ProxyFetchError::InvalidTarget(error.to_string()))?;

        let mut found_address = false;
        for socket_addr in lookup {
            found_address = true;
            if is_blocked_address(socket_addr.ip()) {
                return Err(ProxyFetchError::InvalidTarget(
                    "host resolves to a blocked ip address".to_string(),
                ));
            }
        }

        if !found_address {
            return Err(ProxyFetchError::InvalidTarget(
                "host did not resolve".to_string(),
            ));
        }

        let mut cache = self.validated_hosts.lock().await;
        cache.insert(hostname.to_string(), Instant::now() + HOST_CACHE_TTL);
        Ok(())
    }
}

pub fn build_vod_headers(
    api_site: &ApiSiteConfig,
    range_header: Option<&HeaderValue>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    insert_header_value(&mut headers, header::USER_AGENT, api_site.ua.as_deref());
    insert_header_value(&mut headers, header::REFERER, api_site.referer.as_deref());
    if let Some(range) = range_header {
        headers.insert(header::RANGE, range.clone());
    }
    headers
}

pub fn build_live_headers(
    source: &LiveSourceConfig,
    range_header: Option<&HeaderValue>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    insert_header_value(&mut headers, header::USER_AGENT, Some(source.user_agent()));
    if let Some(range) = range_header {
        headers.insert(header::RANGE, range.clone());
    }
    headers
}

pub fn build_logo_headers(
    source: Option<&LiveSourceConfig>,
    range_header: Option<&HeaderValue>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let user_agent = source.map(LiveSourceConfig::user_agent);
    insert_header_value(&mut headers, header::USER_AGENT, user_agent);
    if let Some(range) = range_header {
        headers.insert(header::RANGE, range.clone());
    }
    headers
}

pub fn infer_vod_asset_content_type(url: &str, is_key: bool) -> String {
    let lowered = url.to_ascii_lowercase();
    if is_key || lowered.ends_with(".key") {
        return "application/octet-stream".to_string();
    }
    if lowered.ends_with(".m4s") || lowered.ends_with(".m4v") {
        return "video/iso.segment".to_string();
    }
    if lowered.ends_with(".mp4") {
        return "video/mp4".to_string();
    }
    if lowered.ends_with(".aac") {
        return "audio/aac".to_string();
    }
    if lowered.ends_with(".vtt") {
        return "text/vtt; charset=utf-8".to_string();
    }
    "video/mp2t".to_string()
}

pub fn looks_like_manifest(url: &str, content_type: Option<&str>) -> bool {
    if let Some(value) = content_type {
        let lowered = value.to_ascii_lowercase();
        if lowered.contains("mpegurl") || lowered.contains("octet-stream") {
            return true;
        }
    }

    url.to_ascii_lowercase().contains(".m3u8")
}

pub fn rewrite_vod_manifest_content(content: &str, final_url: &str, source: &str) -> String {
    let base_url = final_url.to_string();
    let lines = sanitize_vod_manifest_lines(content.lines().collect());
    let mut rewritten = Vec::with_capacity(lines.len());
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index].trim();
        if line.is_empty() {
            rewritten.push(String::new());
            index += 1;
            continue;
        }

        if line.starts_with("#EXT-X-STREAM-INF:") {
            rewritten.push(line.to_string());
            if let Some(next_line) = lines.get(index + 1).map(|value| value.trim()) {
                if !next_line.starts_with('#') && !next_line.is_empty() {
                    let resolved = resolve_url(&base_url, next_line);
                    rewritten.push(build_query_path(
                        "/api/proxy/vod/m3u8",
                        &[("source", source), ("url", resolved.as_str())],
                    ));
                    index += 2;
                    continue;
                }
            }

            index += 1;
            continue;
        }

        if line.starts_with("#EXT-X-MEDIA:") || line.starts_with("#EXT-X-I-FRAME-STREAM-INF:") {
            rewritten.push(rewrite_manifest_attribute_uri(
                line,
                &base_url,
                source,
                "/api/proxy/vod/m3u8",
            ));
            index += 1;
            continue;
        }

        if line.starts_with("#EXT-X-KEY:") || line.starts_with("#EXT-X-SESSION-KEY:") {
            rewritten.push(rewrite_manifest_attribute_uri(
                line,
                &base_url,
                source,
                "/api/proxy/vod/key",
            ));
            index += 1;
            continue;
        }

        if line.starts_with("#EXT-X-MAP:")
            || line.starts_with("#EXT-X-PART:")
            || line.starts_with("#EXT-X-PRELOAD-HINT:")
        {
            rewritten.push(rewrite_manifest_attribute_uri(
                line,
                &base_url,
                source,
                "/api/proxy/vod/segment",
            ));
            index += 1;
            continue;
        }

        if line.starts_with("#EXT-X-RENDITION-REPORT:") {
            rewritten.push(rewrite_manifest_attribute_uri(
                line,
                &base_url,
                source,
                "/api/proxy/vod/m3u8",
            ));
            index += 1;
            continue;
        }

        if !line.starts_with('#') {
            let resolved = resolve_url(&base_url, line);
            let path = if looks_like_manifest(&resolved, None) {
                "/api/proxy/vod/m3u8"
            } else {
                "/api/proxy/vod/segment"
            };
            rewritten.push(build_query_path(
                path,
                &[("source", source), ("url", resolved.as_str())],
            ));
            index += 1;
            continue;
        }

        rewritten.push(line.to_string());
        index += 1;
    }

    rewritten.join("\n")
}

pub fn rewrite_live_m3u8_content(
    content: &str,
    final_url: &str,
    source: &str,
    allow_cors: bool,
) -> String {
    let mut rewritten = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            rewritten.push(String::new());
            continue;
        }

        if line.starts_with("#EXT-X-STREAM-INF:") {
            rewritten.push(line.to_string());
            continue;
        }

        if !line.starts_with('#') {
            let resolved = resolve_url(final_url, line);
            if allow_cors {
                rewritten.push(resolved);
            } else if looks_like_manifest(&resolved, None) {
                rewritten.push(build_query_path(
                    "/api/proxy/m3u8",
                    &[("moontv-source", source), ("url", resolved.as_str())],
                ));
            } else {
                rewritten.push(build_query_path(
                    "/api/proxy/segment",
                    &[("moontv-source", source), ("url", resolved.as_str())],
                ));
            }
            continue;
        }

        if line.starts_with("#EXT-X-MAP:") {
            rewritten.push(rewrite_live_attribute_uri(
                line,
                final_url,
                source,
                "/api/proxy/segment",
            ));
            continue;
        }

        if line.starts_with("#EXT-X-KEY:") {
            rewritten.push(rewrite_live_attribute_uri(
                line,
                final_url,
                source,
                "/api/proxy/key",
            ));
            continue;
        }

        rewritten.push(line.to_string());
    }

    rewritten.join("\n")
}

pub fn resolve_url(base_url: &str, relative: &str) -> String {
    if let Ok(url) = Url::parse(relative) {
        return url.to_string();
    }

    if relative.starts_with("//") {
        if let Ok(base) = Url::parse(base_url) {
            return format!("{}:{}", base.scheme(), relative);
        }
    }

    Url::parse(base_url)
        .ok()
        .and_then(|base| base.join(relative).ok())
        .map(|url| url.to_string())
        .unwrap_or_else(|| relative.to_string())
}

fn rewrite_manifest_attribute_uri(line: &str, base_url: &str, source: &str, path: &str) -> String {
    let Some(uri) = extract_attribute_uri(line) else {
        return line.to_string();
    };
    let resolved = resolve_url(base_url, &uri);
    let replacement = build_query_path(path, &[("source", source), ("url", resolved.as_str())]);
    line.replace(&format!("URI=\"{uri}\""), &format!("URI=\"{replacement}\""))
}

fn rewrite_live_attribute_uri(line: &str, base_url: &str, source: &str, path: &str) -> String {
    let Some(uri) = extract_attribute_uri(line) else {
        return line.to_string();
    };
    let resolved = resolve_url(base_url, &uri);
    let replacement = build_query_path(
        path,
        &[("moontv-source", source), ("url", resolved.as_str())],
    );
    line.replace(&format!("URI=\"{uri}\""), &format!("URI=\"{replacement}\""))
}

fn extract_attribute_uri(line: &str) -> Option<String> {
    let start = line.find("URI=\"")? + 5;
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn build_query_path(path: &str, pairs: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        serializer.append_pair(key, value);
    }
    format!("{path}?{}", serializer.finish())
}

fn sanitize_vod_manifest_lines(lines: Vec<&str>) -> Vec<String> {
    let mut sanitized = Vec::with_capacity(lines.len());
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index].trim();

        if line == "#EXT-X-DISCONTINUITY" {
            let mut cursor = index + 1;
            let mut skipped = false;
            while cursor + 1 < lines.len() {
                let duration_line = lines[cursor].trim();
                let resource_line = lines[cursor + 1].trim();
                if duration_line.starts_with("#EXTINF:")
                    && is_unsupported_vod_segment_uri(resource_line)
                {
                    skipped = true;
                    cursor += 2;
                    continue;
                }
                break;
            }

            if skipped {
                if lines.get(cursor).map(|value| value.trim()) == Some("#EXT-X-DISCONTINUITY") {
                    cursor += 1;
                }
                index = cursor;
                continue;
            }
        }

        if line.starts_with("#EXTINF:")
            && lines
                .get(index + 1)
                .map(|value| is_unsupported_vod_segment_uri(value.trim()))
                .unwrap_or(false)
        {
            index += 2;
            continue;
        }

        if (line.starts_with("#EXT-X-PART:")
            || line.starts_with("#EXT-X-PRELOAD-HINT:")
            || line.starts_with("#EXT-X-MAP:"))
            && is_unsupported_vod_segment_uri(line)
        {
            index += 1;
            continue;
        }

        if is_unsupported_vod_segment_uri(line) {
            index += 1;
            continue;
        }

        sanitized.push(line.to_string());
        index += 1;
    }

    sanitized
}

fn is_unsupported_vod_segment_uri(value: &str) -> bool {
    let target = extract_attribute_uri(value).unwrap_or_else(|| value.to_string());
    target.to_ascii_lowercase().contains("/video/adjump/")
}

fn insert_header_value(headers: &mut HeaderMap, key: header::HeaderName, value: Option<&str>) {
    let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };

    if let Ok(parsed) = HeaderValue::from_str(raw) {
        headers.insert(key, parsed);
    }
}

fn normalize_hostname(hostname: &str) -> String {
    hostname
        .trim()
        .trim_matches('[')
        .trim_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn is_blocked_hostname(hostname: &str) -> bool {
    hostname.is_empty()
        || hostname == "localhost"
        || hostname.ends_with(".localhost")
        || hostname == "metadata.google.internal"
}

fn is_blocked_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(value) => is_blocked_ipv4(value),
        IpAddr::V6(value) => is_blocked_ipv6(value),
    }
}

fn is_blocked_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    let [a, b, c, _] = octets;

    address.is_unspecified()
        || address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 224 && b == 0 && c == 0)
        || a >= 224
}

fn is_blocked_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    address.is_unspecified()
        || address.is_loopback()
        || address.is_unique_local()
        || address.is_unicast_link_local()
        || address.is_multicast()
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_vod_manifest_entries_to_local_proxy_paths() {
        let content = [
            "#EXTM3U",
            "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"",
            "#EXT-X-MAP:URI=\"init.mp4\"",
            "#EXTINF:6.0,",
            "segment-001.ts",
            "#EXTINF:6.0,",
            "/video/adjump/ad.ts",
            "#EXT-X-ENDLIST",
        ]
        .join("\n");

        let rewritten = rewrite_vod_manifest_content(
            &content,
            "https://media.example.com/path/master.m3u8",
            "demo",
        );

        assert!(rewritten.contains(
            "/api/proxy/vod/key?source=demo&url=https%3A%2F%2Fmedia.example.com%2Fpath%2Fkey.bin"
        ));
        assert!(rewritten.contains("/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fmedia.example.com%2Fpath%2Fsegment-001.ts"));
        assert!(!rewritten.contains("adjump"));
    }

    #[test]
    fn blocks_private_ipv4_ranges() {
        assert!(is_blocked_address(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_blocked_address(IpAddr::V4(Ipv4Addr::new(
            192, 168, 1, 1
        ))));
        assert!(!is_blocked_address(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }
}
