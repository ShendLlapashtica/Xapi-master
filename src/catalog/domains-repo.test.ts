import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import {
  computeScores,
  getDomain,
  getLatestAuditResult,
  insertDiscoveredDomain,
  insertDomainAuditDiff,
  insertDomainAuditResult,
  listWatchedDomains,
  setDomainWatched,
} from "./domains-repo";
import type { DomainAuditAttributes } from "../types";

beforeEach(async () => {
  await resetSchema(env.DB);
});

// Minimal but complete -- computeScores/insertDomainAuditResult expect every
// key present, so partial objects would throw at the type level even though
// D1 itself wouldn't care.
function fakeAttrs(overrides: Partial<DomainAuditAttributes> = {}): DomainAuditAttributes {
  const base = {} as DomainAuditAttributes;
  const keys: (keyof DomainAuditAttributes)[] = [
    "a_record_present", "aaaa_record_present", "ns_record_count", "ns_provider_diversity",
    "soa_serial_format_valid", "soa_refresh_value_sane", "soa_retry_value_sane",
    "soa_expire_value_in_range", "soa_minimum_ttl_sane", "caa_record_present",
    "caa_restricts_issuance", "dnssec_enabled", "ttl_reasonable", "glue_records_correct",
    "zone_transfer_axfr_disabled", "mx_record_present", "mx_priority_sane", "spf_record_present",
    "spf_syntax_valid", "spf_mechanism_strictness", "spf_lookup_count_under_10",
    "dmarc_record_present", "dmarc_policy_level", "dmarc_pct_100", "dmarc_reporting_configured",
    "dmarc_alignment_mode", "dkim_selector_published", "dkim_key_strength_adequate",
    "bimi_record_present", "bimi_logo_renders_in_inbox", "reverse_dns_matches_smtp_banner",
    "smtp_starttls_supported", "smtp_open_relay_test_passed", "mta_sts_policy_published",
    "tls_rpt_configured", "https_enforced_no_plain_http", "http_redirect_status_code_expected",
    "hsts_header_present", "hsts_max_age_sufficient", "hsts_preload_eligible",
    "tls_certificate_valid", "tls_certificate_expiry_over_30d", "tls_certificate_issuer_trusted",
    "tls_protocol_no_legacy_versions", "weak_cipher_suites_disabled", "ocsp_stapling_enabled",
    "http2_or_http3_supported", "server_header_hides_version", "redirect_chain_length_reasonable",
    "mixed_content_absent", "robots_txt_present", "sitemap_xml_present",
    "error_pages_no_stack_trace_leak", "compression_enabled", "cookies_secure_flag_set",
    "content_security_policy_present", "x_content_type_options_nosniff",
    "x_frame_options_or_frame_ancestors", "referrer_policy_set", "permissions_policy_set",
    "cross_origin_opener_policy_set", "cross_origin_resource_policy_set",
    "cross_origin_embedder_policy_set", "csp_upgrade_insecure_requests",
    "csp_no_unsafe_inline_without_nonce", "cors_not_wildcard_on_authenticated_routes",
    "cookies_httponly_flag_set", "cookies_samesite_attribute_set", "x_xss_protection_legacy_check",
    "strict_transport_security_present", "domain_on_spam_blacklist", "hosting_ip_on_blacklist",
    "whois_domain_age", "whois_privacy_enabled", "domain_expiry_over_90d",
    "certificate_transparency_log_reviewed", "no_typosquat_lookalikes_flagged",
    "google_safe_browsing_clean", "no_malware_flags", "registrar_identified",
    "hosting_provider_identified", "dns_provider_identified", "sibling_domain_same_operator",
    "cdn_waf_provider_identified", "ip_geolocation_matches_target_market", "asn_reputation",
    "nameserver_single_point_of_failure_check", "registrar_transfer_lock_enabled",
    "auto_renew_enabled", "dnssec_chain_validated_end_to_end", "bulk_pagination_capped",
    "request_signing_present", "rate_limiting_per_ip_configured",
    "api_keys_absent_from_client_bundle", "sequential_id_enumeration_prevented",
    "error_responses_no_stack_trace_leak", "admin_routes_require_auth",
    "cors_restricted_to_known_origins", "source_maps_not_published_to_prod",
    "dependency_vulnerabilities_scanned",
  ];
  for (const k of keys) (base as unknown as Record<string, unknown>)[k] = null;
  return { ...base, ...overrides };
}

describe("domains-repo watching", () => {
  it("marks a domain watched and finds it in the watch list", async () => {
    await insertDiscoveredDomain(env.DB, "d1", "autokoreablendi.com");
    await insertDiscoveredDomain(env.DB, "d2", "example.com");

    await setDomainWatched(env.DB, "d1", true);

    const watched = await listWatchedDomains(env.DB);
    expect(watched.map((d) => d.id)).toEqual(["d1"]);

    const domain = await getDomain(env.DB, "d1");
    expect(domain?.watched_at).not.toBeNull();
  });

  it("unwatches a domain", async () => {
    await insertDiscoveredDomain(env.DB, "d1", "autokoreablendi.com");
    await setDomainWatched(env.DB, "d1", true);
    await setDomainWatched(env.DB, "d1", false);

    expect(await listWatchedDomains(env.DB)).toEqual([]);
  });
});

describe("domain audit diffs", () => {
  it("stores and retrieves a diff between two audit results", async () => {
    await insertDiscoveredDomain(env.DB, "d1", "autokoreablendi.com");

    const prevAttrs = fakeAttrs({ hsts_header_present: false });
    await insertDomainAuditResult(env.DB, "r1", "d1", prevAttrs, computeScores(prevAttrs));
    const prev = await getLatestAuditResult(env.DB, "d1");

    const currAttrs = fakeAttrs({ hsts_header_present: true });
    await insertDomainAuditResult(env.DB, "r2", "d1", currAttrs, computeScores(currAttrs));

    await insertDomainAuditDiff(env.DB, "diff1", "d1", prev!.id, "r2", {
      hsts_header_present: { from: false, to: true },
    });

    const { results } = await env.DB.prepare("SELECT * FROM domain_audit_diffs WHERE domain_id = ?")
      .bind("d1")
      .all<{ id: string; changed_keys: string }>();
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]!.changed_keys)).toEqual({
      hsts_header_present: { from: false, to: true },
    });
  });
});
