// Security headers probe — 15 attributes.
// All derived from the HTTPS response headers of the site root.

export interface HeadersProbeResult {
  content_security_policy_present: boolean | null;
  x_content_type_options_nosniff: boolean | null;
  x_frame_options_or_frame_ancestors: boolean | null; // XFO header OR CSP frame-ancestors
  referrer_policy_set: boolean | null;
  permissions_policy_set: boolean | null;
  cross_origin_opener_policy_set: boolean | null;
  cross_origin_resource_policy_set: boolean | null;
  cross_origin_embedder_policy_set: boolean | null;
  csp_upgrade_insecure_requests: boolean | null;
  csp_no_unsafe_inline_without_nonce: boolean | null; // CSP present and no unsafe-inline without nonce/hash
  cors_not_wildcard_on_authenticated_routes: boolean | null;
  cookies_httponly_flag_set: boolean | null;
  cookies_samesite_attribute_set: boolean | null;
  x_xss_protection_legacy_check: boolean | null; // header is absent (preferred) or set to "1; mode=block"
  strict_transport_security_present: boolean | null;

  // Raw header values for evidence
  _csp: string | null;
  _cors: string | null;
  _xfo: string | null;
  _setCookie: string | null;
}

export async function probeHeaders(hostname: string): Promise<HeadersProbeResult> {
  let res: Response | null = null;
  try {
    res = await fetch(`https://${hostname}/`, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Use a realistic User-Agent so WAFs don't return a challenge page
        // (which would have different headers than the real app response).
        "User-Agent":
          "Mozilla/5.0 (compatible; XapiSecurityAudit/1.0; +https://xapi.prishtina-online.workers.dev)",
      },
    });
  } catch {
    // Full probe failure — return all nulls
    return {
      content_security_policy_present: null,
      x_content_type_options_nosniff: null,
      x_frame_options_or_frame_ancestors: null,
      referrer_policy_set: null,
      permissions_policy_set: null,
      cross_origin_opener_policy_set: null,
      cross_origin_resource_policy_set: null,
      cross_origin_embedder_policy_set: null,
      csp_upgrade_insecure_requests: null,
      csp_no_unsafe_inline_without_nonce: null,
      cors_not_wildcard_on_authenticated_routes: null,
      cookies_httponly_flag_set: null,
      cookies_samesite_attribute_set: null,
      x_xss_protection_legacy_check: null,
      strict_transport_security_present: null,
      _csp: null,
      _cors: null,
      _xfo: null,
      _setCookie: null,
    };
  }

  const h = (name: string) => res!.headers.get(name);

  const _csp = h("content-security-policy");
  const _cors = h("access-control-allow-origin");
  const _xfo = h("x-frame-options");
  const _setCookie = h("set-cookie");

  // CSP
  const content_security_policy_present = Boolean(_csp);
  const csp_upgrade_insecure_requests =
    _csp !== null ? /upgrade-insecure-requests/i.test(_csp) : false;

  // "unsafe-inline" without a nonce ('nonce-...') or hash ('sha256-...')
  // If unsafe-inline is present AND no nonce/hash fallback, it's a problem.
  let csp_no_unsafe_inline_without_nonce: boolean | null = null;
  if (_csp !== null) {
    const hasUnsafeInline = /unsafe-inline/i.test(_csp);
    const hasNonceOrHash = /'nonce-[^']+'/i.test(_csp) || /'sha\d+-[^']+'/i.test(_csp);
    csp_no_unsafe_inline_without_nonce = !hasUnsafeInline || hasNonceOrHash;
  }

  // X-Frame-Options or frame-ancestors in CSP
  const hasFrameAncestors = _csp !== null && /frame-ancestors/i.test(_csp);
  const x_frame_options_or_frame_ancestors = Boolean(_xfo) || hasFrameAncestors;

  // X-Content-Type-Options
  const xcto = h("x-content-type-options");
  const x_content_type_options_nosniff = xcto !== null ? /nosniff/i.test(xcto) : false;

  // Referrer-Policy
  const rp = h("referrer-policy");
  const referrer_policy_set = Boolean(rp);

  // Permissions-Policy (formerly Feature-Policy)
  const pp = h("permissions-policy") ?? h("feature-policy");
  const permissions_policy_set = Boolean(pp);

  // Cross-Origin headers
  const coop = h("cross-origin-opener-policy");
  const corp = h("cross-origin-resource-policy");
  const coep = h("cross-origin-embedder-policy");
  const cross_origin_opener_policy_set = Boolean(coop);
  const cross_origin_resource_policy_set = Boolean(corp);
  const cross_origin_embedder_policy_set = Boolean(coep);

  // CORS wildcard
  // A wildcard on the root is only a problem if the route serves auth-protected
  // data -- we can't know that without app knowledge, so we flag it if present.
  const cors_not_wildcard_on_authenticated_routes =
    _cors !== null ? _cors.trim() !== "*" : true; // no CORS header = not a wildcard

  // Cookies
  let cookies_httponly_flag_set: boolean | null = null;
  let cookies_samesite_attribute_set: boolean | null = null;
  if (_setCookie !== null) {
    const cookies = _setCookie.split(/,(?=[^;]+=[^;]+)/);
    cookies_httponly_flag_set = cookies.every((c) => /;\s*HttpOnly/i.test(c));
    cookies_samesite_attribute_set = cookies.every((c) => /;\s*SameSite=/i.test(c));
  } else {
    // No cookies set on root response — not a fail
    cookies_httponly_flag_set = true;
    cookies_samesite_attribute_set = true;
  }

  // X-XSS-Protection (legacy; modern guidance is to omit or set "0")
  const xxp = h("x-xss-protection");
  // Pass if absent (recommended) or "0" or "1; mode=block" (acceptable)
  const x_xss_protection_legacy_check =
    xxp === null || xxp === "0" || /^1;\s*mode=block/i.test(xxp);

  // HSTS (duplicate of TLS probe — included here for the headers score bucket)
  const hsts = h("strict-transport-security");
  const strict_transport_security_present = Boolean(hsts);

  return {
    content_security_policy_present,
    x_content_type_options_nosniff,
    x_frame_options_or_frame_ancestors,
    referrer_policy_set,
    permissions_policy_set,
    cross_origin_opener_policy_set,
    cross_origin_resource_policy_set,
    cross_origin_embedder_policy_set,
    csp_upgrade_insecure_requests,
    csp_no_unsafe_inline_without_nonce,
    cors_not_wildcard_on_authenticated_routes,
    cookies_httponly_flag_set,
    cookies_samesite_attribute_set,
    x_xss_protection_legacy_check,
    strict_transport_security_present,
    _csp,
    _cors,
    _xfo,
    _setCookie,
  };
}
