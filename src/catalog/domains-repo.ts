import type {
  DomainRow,
  DomainAuditStatus,
  DomainAuditResultRow,
  DomainAuditAttributes,
  DomainSummaryDTO,
  DomainsQueryParams,
  DomainsResponse,
} from "../types";
import type { AttributeDiff } from "../audit/domain-audit-diff";

const MAX_LIMIT = 25;

// ---- Domain CRUD ----

export async function findDomainByHostname(
  db: D1Database,
  hostname: string,
): Promise<DomainRow | null> {
  const row = await db
    .prepare("SELECT * FROM domains WHERE hostname = ?")
    .bind(hostname)
    .first<DomainRow>();
  return row ?? null;
}

export async function getDomain(
  db: D1Database,
  id: string,
): Promise<DomainRow | null> {
  const row = await db
    .prepare("SELECT * FROM domains WHERE id = ?")
    .bind(id)
    .first<DomainRow>();
  return row ?? null;
}

export async function insertDiscoveredDomain(
  db: D1Database,
  id: string,
  hostname: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO domains (id, hostname, audit_status)
       VALUES (?, ?, 'discovered')`,
    )
    .bind(id, hostname)
    .run();
}

export async function updateDomainAuditStatus(
  db: D1Database,
  id: string,
  status: DomainAuditStatus,
): Promise<void> {
  if (status === "done" || status === "error") {
    await db
      .prepare(
        "UPDATE domains SET audit_status = ?, last_audited_at = ? WHERE id = ?",
      )
      .bind(status, new Date().toISOString(), id)
      .run();
  } else {
    await db
      .prepare("UPDATE domains SET audit_status = ? WHERE id = ?")
      .bind(status, id)
      .run();
  }
}

// ---- Watching (recurring self-audit work list) ----

export async function setDomainWatched(
  db: D1Database,
  id: string,
  watched: boolean,
): Promise<void> {
  await db
    .prepare(
      "UPDATE domains SET watched = ?, watched_at = ? WHERE id = ?",
    )
    .bind(watched ? 1 : 0, watched ? new Date().toISOString() : null, id)
    .run();
}

// Re-read fresh on every DomainAuditAgent tick rather than cached in Agent
// state -- same rationale as ListenerAgent.poll()'s account roster read.
export async function listWatchedDomains(db: D1Database): Promise<DomainRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM domains WHERE watched = 1")
    .all<DomainRow>();
  return results;
}

// ---- Audit results ----

export interface DomainAuditScores {
  total: number;
  dns: number;
  email: number;
  tls: number;
  headers: number;
  reputation: number;
  infra: number;
  app: number;
}

/** Count passing (true) attributes within a subset of keys. */
export function scoreAttributes(
  attrs: DomainAuditAttributes,
  keys: (keyof DomainAuditAttributes)[],
): number {
  return keys.reduce((sum, k) => {
    const v = attrs[k];
    return sum + (v === true ? 1 : 0);
  }, 0);
}

// Key groups per family — must match the 100-attribute schema in types.ts
const DNS_KEYS: (keyof DomainAuditAttributes)[] = [
  "a_record_present",
  "aaaa_record_present",
  "ns_record_count",
  "ns_provider_diversity",
  "soa_serial_format_valid",
  "soa_refresh_value_sane",
  "soa_retry_value_sane",
  "soa_expire_value_in_range",
  "soa_minimum_ttl_sane",
  "caa_record_present",
  "caa_restricts_issuance",
  "dnssec_enabled",
  "ttl_reasonable",
  "glue_records_correct",
  "zone_transfer_axfr_disabled",
];

const EMAIL_KEYS: (keyof DomainAuditAttributes)[] = [
  "mx_record_present",
  "mx_priority_sane",
  "spf_record_present",
  "spf_syntax_valid",
  "spf_mechanism_strictness",
  "spf_lookup_count_under_10",
  "dmarc_record_present",
  "dmarc_policy_level",
  "dmarc_pct_100",
  "dmarc_reporting_configured",
  "dmarc_alignment_mode",
  "dkim_selector_published",
  "dkim_key_strength_adequate",
  "bimi_record_present",
  "bimi_logo_renders_in_inbox",
  "reverse_dns_matches_smtp_banner",
  "smtp_starttls_supported",
  "smtp_open_relay_test_passed",
  "mta_sts_policy_published",
  "tls_rpt_configured",
];

const TLS_KEYS: (keyof DomainAuditAttributes)[] = [
  "https_enforced_no_plain_http",
  "http_redirect_status_code_expected",
  "hsts_header_present",
  "hsts_max_age_sufficient",
  "hsts_preload_eligible",
  "tls_certificate_valid",
  "tls_certificate_expiry_over_30d",
  "tls_certificate_issuer_trusted",
  "tls_protocol_no_legacy_versions",
  "weak_cipher_suites_disabled",
  "ocsp_stapling_enabled",
  "http2_or_http3_supported",
  "server_header_hides_version",
  "redirect_chain_length_reasonable",
  "mixed_content_absent",
  "robots_txt_present",
  "sitemap_xml_present",
  "error_pages_no_stack_trace_leak",
  "compression_enabled",
  "cookies_secure_flag_set",
];

const HEADERS_KEYS: (keyof DomainAuditAttributes)[] = [
  "content_security_policy_present",
  "x_content_type_options_nosniff",
  "x_frame_options_or_frame_ancestors",
  "referrer_policy_set",
  "permissions_policy_set",
  "cross_origin_opener_policy_set",
  "cross_origin_resource_policy_set",
  "cross_origin_embedder_policy_set",
  "csp_upgrade_insecure_requests",
  "csp_no_unsafe_inline_without_nonce",
  "cors_not_wildcard_on_authenticated_routes",
  "cookies_httponly_flag_set",
  "cookies_samesite_attribute_set",
  "x_xss_protection_legacy_check",
  "strict_transport_security_present",
];

const REPUTATION_KEYS: (keyof DomainAuditAttributes)[] = [
  "domain_on_spam_blacklist",
  "hosting_ip_on_blacklist",
  "whois_domain_age",
  "whois_privacy_enabled",
  "domain_expiry_over_90d",
  "certificate_transparency_log_reviewed",
  "no_typosquat_lookalikes_flagged",
  "google_safe_browsing_clean",
  "no_malware_flags",
  "registrar_identified",
];

const INFRA_KEYS: (keyof DomainAuditAttributes)[] = [
  "hosting_provider_identified",
  "dns_provider_identified",
  "sibling_domain_same_operator",
  "cdn_waf_provider_identified",
  "ip_geolocation_matches_target_market",
  "asn_reputation",
  "nameserver_single_point_of_failure_check",
  "registrar_transfer_lock_enabled",
  "auto_renew_enabled",
  "dnssec_chain_validated_end_to_end",
];

const APP_KEYS: (keyof DomainAuditAttributes)[] = [
  "bulk_pagination_capped",
  "request_signing_present",
  "rate_limiting_per_ip_configured",
  "api_keys_absent_from_client_bundle",
  "sequential_id_enumeration_prevented",
  "error_responses_no_stack_trace_leak",
  "admin_routes_require_auth",
  "cors_restricted_to_known_origins",
  "source_maps_not_published_to_prod",
  "dependency_vulnerabilities_scanned",
];

export function computeScores(attrs: DomainAuditAttributes): DomainAuditScores {
  const dns = scoreAttributes(attrs, DNS_KEYS);
  const email = scoreAttributes(attrs, EMAIL_KEYS);
  const tls = scoreAttributes(attrs, TLS_KEYS);
  const headers = scoreAttributes(attrs, HEADERS_KEYS);
  const reputation = scoreAttributes(attrs, REPUTATION_KEYS);
  const infra = scoreAttributes(attrs, INFRA_KEYS);
  const app = scoreAttributes(attrs, APP_KEYS);
  return {
    dns,
    email,
    tls,
    headers,
    reputation,
    infra,
    app,
    total: dns + email + tls + headers + reputation + infra + app,
  };
}

export async function insertDomainAuditResult(
  db: D1Database,
  resultId: string,
  domainId: string,
  attrs: DomainAuditAttributes,
  scores: DomainAuditScores,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO domain_audit_results
         (id, domain_id, score_total, score_dns, score_email, score_tls,
          score_headers, score_reputation, score_infra, score_app, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      resultId,
      domainId,
      scores.total,
      scores.dns,
      scores.email,
      scores.tls,
      scores.headers,
      scores.reputation,
      scores.infra,
      scores.app,
      JSON.stringify(attrs),
    )
    .run();
}

export async function getLatestAuditResult(
  db: D1Database,
  domainId: string,
): Promise<DomainAuditResultRow | null> {
  const row = await db
    .prepare(
      "SELECT * FROM domain_audit_results WHERE domain_id = ? ORDER BY audited_at DESC LIMIT 1",
    )
    .bind(domainId)
    .first<DomainAuditResultRow>();
  return row ?? null;
}

// Only ever called when diffAttributes() found a non-empty change set (see
// domain-audit-workflow.ts's compute-diff step) -- this table is "what
// changed between two runs", not a row-per-run redundant copy.
export async function insertDomainAuditDiff(
  db: D1Database,
  id: string,
  domainId: string,
  prevResultId: string,
  currResultId: string,
  changedKeys: AttributeDiff,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO domain_audit_diffs (id, domain_id, prev_result_id, curr_result_id, changed_keys)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, domainId, prevResultId, currResultId, JSON.stringify(changedKeys))
    .run();
}

// ---- Domain ↔ Component edges ----

export async function linkDomainToComponent(
  db: D1Database,
  domainId: string,
  componentId: string,
  relationship: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO domain_component_edges (id, domain_id, component_id, relationship)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), domainId, componentId, relationship)
    .run();
}

export async function linkDomainSibling(
  db: D1Database,
  domainAId: string,
  domainBId: string,
): Promise<void> {
  // Store canonical order (smaller id first) to avoid duplicate pairs
  const [a, b] = [domainAId, domainBId].sort();
  await db
    .prepare(
      `INSERT OR IGNORE INTO domain_sibling_edges (id, domain_a_id, domain_b_id)
       VALUES (?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), a, b)
    .run();
}

// ---- Listing ----

export async function listDomains(
  db: D1Database,
  params: DomainsQueryParams,
): Promise<DomainsResponse> {
  const limit = Math.min(params.limit ?? 12, MAX_LIMIT);

  // Build paginated domain rows
  let domainRows: DomainRow[];
  if (params.cursor) {
    const { results } = await db
      .prepare(
        "SELECT * FROM domains WHERE id > ? ORDER BY id ASC LIMIT ?",
      )
      .bind(params.cursor, limit + 1)
      .all<DomainRow>();
    domainRows = results;
  } else {
    const { results } = await db
      .prepare("SELECT * FROM domains ORDER BY id ASC LIMIT ?")
      .bind(limit + 1)
      .all<DomainRow>();
    domainRows = results;
  }

  const hasMore = domainRows.length > limit;
  const page = hasMore ? domainRows.slice(0, limit) : domainRows;

  // Fetch latest audit result for each domain
  const dtos: DomainSummaryDTO[] = await Promise.all(
    page.map(async (d) => {
      const latest = await getLatestAuditResult(db, d.id);
      return {
        id: d.id,
        hostname: d.hostname,
        auditStatus: d.audit_status,
        lastAuditedAt: d.last_audited_at,
        discoveredAt: d.discovered_at,
        latestAudit: latest
          ? {
              scoreTotal: latest.score_total,
              scoreDns: latest.score_dns,
              scoreEmail: latest.score_email,
              scoreTls: latest.score_tls,
              scoreHeaders: latest.score_headers,
              scoreReputation: latest.score_reputation,
              scoreInfra: latest.score_infra,
              scoreApp: latest.score_app,
              auditedAt: latest.audited_at,
            }
          : null,
      };
    }),
  );

  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
  return { domains: dtos, nextCursor };
}
