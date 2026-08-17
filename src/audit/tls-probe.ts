// TLS / web-server probe — 20 attributes.
// Uses fetch() HEAD/GET requests against http:// and https:// variants.
// Workers follow redirects by default; we use `redirect: "manual"` where
// we need to inspect redirect chains directly.

export interface TlsProbeResult {
  https_enforced_no_plain_http: boolean | null;
  http_redirect_status_code_expected: boolean | null; // 301 preferred; 308 is valid but flagged
  hsts_header_present: boolean | null;
  hsts_max_age_sufficient: boolean | null;  // max-age >= 31536000 (1 year)
  hsts_preload_eligible: boolean | null;    // has includeSubDomains + preload
  tls_certificate_valid: boolean | null;    // fetch to https:// succeeded (no TLS error)
  tls_certificate_expiry_over_30d: boolean | null; // null — not inspectable from Workers fetch
  tls_certificate_issuer_trusted: boolean | null;  // null — not inspectable from Workers fetch
  tls_protocol_no_legacy_versions: boolean | null; // null — not inspectable from Workers fetch
  weak_cipher_suites_disabled: boolean | null;     // null — not inspectable from Workers fetch
  ocsp_stapling_enabled: boolean | null;           // null — not inspectable from Workers fetch
  http2_or_http3_supported: boolean | null; // inferred from cf-ray presence or alt-svc header
  server_header_hides_version: boolean | null; // Server header has no version string
  redirect_chain_length_reasonable: boolean | null; // chain length <= 3
  mixed_content_absent: boolean | null;     // heuristic: CSP blocks mixed content
  robots_txt_present: boolean | null;
  sitemap_xml_present: boolean | null;
  error_pages_no_stack_trace_leak: boolean | null; // 404 body doesn't contain stack frames
  compression_enabled: boolean | null;     // Content-Encoding: gzip|br|zstd on response
  cookies_secure_flag_set: boolean | null; // all Set-Cookie headers have Secure flag

  // Raw values
  _httpStatus: number | null;
  _httpsStatus: number | null;
  _redirectChainLength: number;
  _serverHeader: string | null;
}

async function headSafe(
  url: string,
  opts: RequestInit = {},
): Promise<Response | null> {
  try {
    return await fetch(url, { method: "HEAD", ...opts });
  } catch {
    return null;
  }
}

async function getSafe(
  url: string,
  opts: RequestInit = {},
): Promise<Response | null> {
  try {
    return await fetch(url, { method: "GET", ...opts });
  } catch {
    return null;
  }
}

/** Follow redirect chain manually, returning each hop's status code. */
async function followRedirects(
  startUrl: string,
  maxHops = 6,
): Promise<{ statuses: number[]; finalUrl: string }> {
  let url = startUrl;
  const statuses: number[] = [];
  for (let i = 0; i < maxHops; i++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { method: "HEAD", redirect: "manual" });
    } catch {
      break;
    }
    statuses.push(res.status);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      url = location.startsWith("http") ? location : new URL(location, url).href;
    } else {
      break;
    }
  }
  return { statuses, finalUrl: url };
}

function parseHstsMaxAge(hstsHeader: string): number | null {
  const m = hstsHeader.match(/max-age\s*=\s*(\d+)/i);
  return m ? parseInt(m[1] ?? "0", 10) : null;
}

export async function probeTls(hostname: string): Promise<TlsProbeResult> {
  const httpUrl = `http://${hostname}/`;
  const httpsUrl = `https://${hostname}/`;

  // Run probes concurrently where possible
  const [httpChain, httpsRes, robotsRes, sitemapRes, notFoundRes] = await Promise.all([
    followRedirects(httpUrl),
    headSafe(httpsUrl, { redirect: "follow" }),
    headSafe(`${httpsUrl}robots.txt`),
    headSafe(`${httpsUrl}sitemap.xml`),
    getSafe(`${httpsUrl}_thispathshouldnot404exist_xapi_probe`),
  ]);

  // HTTP → HTTPS redirect
  const _httpStatus = httpChain.statuses[0] ?? null;
  const https_enforced_no_plain_http =
    _httpStatus !== null
      ? httpChain.statuses.length > 0 &&
        httpChain.statuses.some((s) => s >= 300 && s < 400) &&
        httpChain.finalUrl.startsWith("https://")
      : null;

  // Redirect status code (prefer 301, accept 308 — but 308 is flagged as non-standard for this)
  const http_redirect_status_code_expected =
    _httpStatus !== null ? _httpStatus === 301 : null;

  const _redirectChainLength = httpChain.statuses.length;
  const redirect_chain_length_reasonable =
    _redirectChainLength > 0 ? _redirectChainLength <= 3 : null;

  // HTTPS reachability = certificate valid (Workers throw on TLS errors)
  const _httpsStatus = httpsRes?.status ?? null;
  const tls_certificate_valid = _httpsStatus !== null ? true : false;

  // HSTS
  const hstsHeader = httpsRes?.headers.get("strict-transport-security") ?? null;
  const hsts_header_present = httpsRes !== null ? Boolean(hstsHeader) : null;
  const hstsMaxAge = hstsHeader ? parseHstsMaxAge(hstsHeader) : null;
  const hsts_max_age_sufficient =
    hstsMaxAge !== null ? hstsMaxAge >= 31536000 : hsts_header_present === false ? false : null;
  const hsts_preload_eligible =
    hstsHeader !== null
      ? /includeSubDomains/i.test(hstsHeader) && /preload/i.test(hstsHeader)
      : hsts_header_present === false
        ? false
        : null;

  // HTTP/2 or HTTP/3 — inferred: Workers deliver HTTP/1.1 responses by default
  // but the `alt-svc` or `cf-ray` header hints at h2/h3 on the origin.
  const altSvc = httpsRes?.headers.get("alt-svc") ?? "";
  const cfRay = httpsRes?.headers.get("cf-ray") ?? "";
  const http2_or_http3_supported =
    httpsRes !== null ? Boolean(altSvc || cfRay) : null;

  // Server header
  const _serverHeader = httpsRes?.headers.get("server") ?? null;
  const server_header_hides_version =
    _serverHeader !== null
      ? !/[\d.]+/.test(_serverHeader) // version string check
      : httpsRes !== null
        ? true // no Server header at all = good
        : null;

  // Cookies Secure flag — check Set-Cookie headers from the HTTPS root
  const setCookieHeader = httpsRes?.headers.get("set-cookie") ?? null;
  let cookies_secure_flag_set: boolean | null = null;
  if (setCookieHeader !== null) {
    // Workers collapse multiple Set-Cookie into one comma-separated string
    const cookies = setCookieHeader.split(/,(?=[^;]+=[^;]+)/);
    cookies_secure_flag_set = cookies.every((c) => /;\s*Secure/i.test(c));
  } else if (httpsRes !== null) {
    cookies_secure_flag_set = true; // no cookies set on root = not a failure
  }

  // Compression
  const contentEncoding = httpsRes?.headers.get("content-encoding") ?? null;
  const compression_enabled =
    httpsRes !== null ? /gzip|br|zstd/i.test(contentEncoding ?? "") : null;

  // Robots + sitemap
  const robots_txt_present = robotsRes !== null ? robotsRes.ok : null;
  const sitemap_xml_present = sitemapRes !== null ? sitemapRes.ok : null;

  // Error page stack trace leak — GET a nonexistent path and check body for stack frames
  let error_pages_no_stack_trace_leak: boolean | null = null;
  if (notFoundRes) {
    const body = await notFoundRes.text().catch(() => "");
    // Common stack frame patterns: "at Object." "at /path/file.js" "Error:"
    const stackPattern = /\bat\s+\w+|\.js:\d+:\d+|SyntaxError:|TypeError:/;
    error_pages_no_stack_trace_leak = !stackPattern.test(body);
  }

  // Mixed content heuristic: if CSP is set and contains upgrade-insecure-requests
  // or block-all-mixed-content, we call it absent. Otherwise null (can't crawl full page).
  const cspHeader = httpsRes?.headers.get("content-security-policy") ?? null;
  const mixed_content_absent =
    cspHeader !== null
      ? /upgrade-insecure-requests|block-all-mixed-content/i.test(cspHeader)
      : null;

  return {
    https_enforced_no_plain_http,
    http_redirect_status_code_expected,
    hsts_header_present,
    hsts_max_age_sufficient,
    hsts_preload_eligible,
    tls_certificate_valid,
    tls_certificate_expiry_over_30d: null, // not available via Workers fetch
    tls_certificate_issuer_trusted: null,
    tls_protocol_no_legacy_versions: null,
    weak_cipher_suites_disabled: null,
    ocsp_stapling_enabled: null,
    http2_or_http3_supported,
    server_header_hides_version,
    redirect_chain_length_reasonable,
    mixed_content_absent,
    robots_txt_present,
    sitemap_xml_present,
    error_pages_no_stack_trace_leak,
    compression_enabled,
    cookies_secure_flag_set,
    _httpStatus,
    _httpsStatus,
    _redirectChainLength,
    _serverHeader,
  };
}
