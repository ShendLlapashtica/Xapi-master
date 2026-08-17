// App-layer hygiene probe — 10 attributes from Phase 1-3 of the security brief.
// Probes the live site: fetches the HTML root, discovers JS bundles, checks
// for leaked secrets, source maps, stack traces, CORS, and admin auth.
// All requests are read-only HEAD or GET with no authentication.

export interface AppProbeResult {
  bulk_pagination_capped: boolean | null;         // null — requires API schema knowledge
  request_signing_present: boolean | null;        // null — requires API schema knowledge
  rate_limiting_per_ip_configured: boolean | null; // heuristic: rate-limit headers present
  api_keys_absent_from_client_bundle: boolean | null; // grep JS bundle for known key patterns
  sequential_id_enumeration_prevented: boolean | null; // heuristic: UUIDs in HTML/JS vs integers
  error_responses_no_stack_trace_leak: boolean | null; // same as TLS probe's 404 check
  admin_routes_require_auth: boolean | null;      // HEAD /admin, /api/admin return non-200
  cors_restricted_to_known_origins: boolean | null; // ACAO header != "*"
  source_maps_not_published_to_prod: boolean | null; // JS bundle .map not reachable
  dependency_vulnerabilities_scanned: boolean | null; // null — requires lockfile access
}

// Patterns that indicate leaked secrets in a JS bundle.
// These are characteristic prefixes/patterns, not full keys — designed to match
// the kind of thing that ends up in a Vite bundle when an env var leaks.
const SECRET_PATTERNS = [
  /eyJhbGciOiJ[A-Za-z0-9+/=]{20,}/,    // JWT-shaped token
  /sk_live_[A-Za-z0-9]{20,}/,           // Stripe live key
  /sk_test_[A-Za-z0-9]{20,}/,           // Stripe test key
  /SUPABASE_KEY\s*[:=]\s*['"][A-Za-z0-9.]{20,}/i,
  /DATABASE_URL\s*[:=]\s*['"]postgres/i,
  /PRIVATE_KEY\s*[:=]/i,
  /CLOUDFLARE_API_TOKEN\s*[:=]/i,
  /ghp_[A-Za-z0-9]{36}/,               // GitHub personal access token
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
];

async function getSafe(url: string, opts: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, { method: "GET", ...opts });
  } catch {
    return null;
  }
}

async function headSafe(url: string, opts: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, { method: "HEAD", ...opts });
  } catch {
    return null;
  }
}

/** Extract JS bundle URLs from an HTML string (src attributes of <script> tags). */
function extractScriptUrls(html: string, baseUrl: string): string[] {
  const matches = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi)];
  return matches
    .map((m) => {
      const src = m[1] ?? "";
      if (src.startsWith("http")) return src;
      if (src.startsWith("/")) return new URL(src, baseUrl).href;
      return null;
    })
    .filter(Boolean) as string[];
}

export async function probeApp(hostname: string): Promise<AppProbeResult> {
  const baseUrl = `https://${hostname}`;

  // 1. Fetch HTML root to discover JS bundle URLs
  const rootRes = await getSafe(`${baseUrl}/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; XapiSecurityAudit/1.0; +https://xapi.prishtina-online.workers.dev)",
    },
  });

  let htmlBody = "";
  if (rootRes?.ok) {
    htmlBody = await rootRes.text().catch(() => "");
  }

  const scriptUrls = extractScriptUrls(htmlBody, baseUrl);

  // 2. Check for source maps and secret leakage in JS bundles
  // Limit to first 3 bundles to stay within Worker CPU time
  let api_keys_absent_from_client_bundle: boolean | null = scriptUrls.length > 0 ? true : null;
  let source_maps_not_published_to_prod: boolean | null = scriptUrls.length > 0 ? true : null;

  for (const scriptUrl of scriptUrls.slice(0, 3)) {
    // Check source map
    const mapUrl = `${scriptUrl}.map`;
    const mapRes = await headSafe(mapUrl);
    if (mapRes?.ok) {
      source_maps_not_published_to_prod = false;
    }

    // Fetch bundle content and grep for secrets
    if (api_keys_absent_from_client_bundle !== false) {
      const bundleRes = await getSafe(scriptUrl);
      if (bundleRes?.ok) {
        // Read up to 512 KB — enough to catch any leaked env vars without
        // exhausting Worker memory on large bundles.
        const bundleText = await bundleRes.text().catch(() => "");
        const truncated = bundleText.slice(0, 512 * 1024);
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(truncated)) {
            api_keys_absent_from_client_bundle = false;
            break;
          }
        }
      }
    }
  }

  // 3. Check if admin routes require auth
  const adminPaths = ["/admin", "/api/admin", "/dashboard", "/_admin"];
  const adminResults = await Promise.all(adminPaths.map((p) => headSafe(`${baseUrl}${p}`)));
  // Admin routes should return 401, 403, or redirect to login (3xx) — not 200 or 404
  const adminStatuses = adminResults
    .filter((r) => r !== null)
    .map((r) => r!.status);

  let admin_routes_require_auth: boolean | null = null;
  if (adminStatuses.length > 0) {
    // Any 200 on an admin path without auth = fail
    // 401/403 = pass. 3xx = likely login redirect = pass. 404 = route doesn't exist = neutral.
    const exposed = adminStatuses.filter((s) => s === 200);
    admin_routes_require_auth = exposed.length === 0;
  }

  // 4. CORS check on root
  const corsHeader = rootRes?.headers.get("access-control-allow-origin") ?? null;
  const cors_restricted_to_known_origins =
    corsHeader !== null ? corsHeader.trim() !== "*" : true;

  // 5. Rate limiting heuristic — RateLimit/X-RateLimit headers
  const rateLimitHeader =
    rootRes?.headers.get("ratelimit-limit") ??
    rootRes?.headers.get("x-ratelimit-limit") ??
    rootRes?.headers.get("retry-after") ?? // some WAFs only expose this on 429
    null;
  const rate_limiting_per_ip_configured =
    rootRes !== null ? Boolean(rateLimitHeader) : null;

  // 6. Sequential ID enumeration check — look for /1, /2, /3 patterns in HTML
  const sequential_id_enumeration_prevented =
    htmlBody
      ? !/(href|src|action)=["'][^"']*\/\d{1,6}["']/gi.test(htmlBody)
      : null;

  // 7. Error page / stack trace leak (fetch a guaranteed-missing path)
  const notFoundRes = await getSafe(`${baseUrl}/_xapi_probe_404_check`);
  let error_responses_no_stack_trace_leak: boolean | null = null;
  if (notFoundRes) {
    const body = await notFoundRes.text().catch(() => "");
    const stackPattern = /\bat\s+\w+|\\.js:\\d+:\\d+|SyntaxError:|TypeError:|Error:/;
    error_responses_no_stack_trace_leak = !stackPattern.test(body);
  }

  return {
    bulk_pagination_capped: null,       // requires API contract knowledge
    request_signing_present: null,      // requires API contract knowledge
    rate_limiting_per_ip_configured,
    api_keys_absent_from_client_bundle,
    sequential_id_enumeration_prevented,
    error_responses_no_stack_trace_leak,
    admin_routes_require_auth,
    cors_restricted_to_known_origins,
    source_maps_not_published_to_prod,
    dependency_vulnerabilities_scanned: null, // requires lockfile access
  };
}
