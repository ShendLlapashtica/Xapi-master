import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env, DomainAuditWorkflowParams, DomainAuditAttributes } from "../types";
import { probeDns } from "./dns-probe";
import { probeEmail } from "./email-probe";
import { probeTls } from "./tls-probe";
import { probeHeaders } from "./headers-probe";
import { probeInfra } from "./infra-probe";
import { probeApp } from "./app-probe";
import { probeReputation } from "./reputation-probe";
import {
  getDomain,
  updateDomainAuditStatus,
  insertDomainAuditResult,
  insertDomainAuditDiff,
  getLatestAuditResult,
  computeScores,
  linkDomainSibling,
} from "../catalog/domains-repo";
import { writeEvidenceBatch } from "../catalog/evidence-store";
import { diffAttributes } from "./domain-audit-diff";

function domainEvidenceKey(domainId: string, probe: string): string {
  return `domains/${domainId}/audit/${probe}.json`;
}

// One Workflow instance per audit run. Re-auditing the same domain creates
// a second instance (different id) and appends a new domain_audit_results row —
// it does NOT overwrite the previous result, preserving audit history.
export class DomainAuditWorkflow extends WorkflowEntrypoint<Env, DomainAuditWorkflowParams> {
  async run(event: WorkflowEvent<DomainAuditWorkflowParams>, step: WorkflowStep): Promise<void> {
    const { domainId, hostname } = event.payload;

    // Confirm the domain row exists
    await step.do("load-domain", async () => {
      const row = await getDomain(this.env.DB, domainId);
      if (!row) {
        throw new NonRetryableError(`domain ${domainId} not found`);
      }
      return row;
    });

    await step.do("mark-auditing", async () => {
      await updateDomainAuditStatus(this.env.DB, domainId, "auditing");
    });

    // ---- Probes ----
    // Run all six passive probes. Each is a named step so Workflows can resume
    // from the correct point on retry without re-running completed probes.

    const dnsResult = await step.do("probe-dns", async () => {
      return probeDns(hostname);
    });

    const emailResult = await step.do("probe-email", async () => {
      return probeEmail(hostname);
    });

    const tlsResult = await step.do("probe-tls", async () => {
      return probeTls(hostname);
    });

    const headersResult = await step.do("probe-headers", async () => {
      return probeHeaders(hostname);
    });

    const infraResult = await step.do("probe-infra", async () => {
      // Pass DB so sibling domain lookup can run
      return probeInfra(hostname, this.env.DB);
    });

    const appResult = await step.do("probe-app", async () => {
      return probeApp(hostname);
    });

    const reputationResult = await step.do("probe-reputation", async () => {
      return probeReputation(hostname);
    });

    // ---- Merge results into the 100-attribute object ----
    const attrs: DomainAuditAttributes = await step.do("merge-attributes", async () => {
      return {
        // DNS (15)
        a_record_present: dnsResult.a_record_present,
        aaaa_record_present: dnsResult.aaaa_record_present,
        ns_record_count: dnsResult.ns_record_count,
        ns_provider_diversity: dnsResult.ns_provider_diversity,
        soa_serial_format_valid: dnsResult.soa_serial_format_valid,
        soa_refresh_value_sane: dnsResult.soa_refresh_value_sane,
        soa_retry_value_sane: dnsResult.soa_retry_value_sane,
        soa_expire_value_in_range: dnsResult.soa_expire_value_in_range,
        soa_minimum_ttl_sane: dnsResult.soa_minimum_ttl_sane,
        caa_record_present: dnsResult.caa_record_present,
        caa_restricts_issuance: dnsResult.caa_restricts_issuance,
        dnssec_enabled: dnsResult.dnssec_enabled,
        ttl_reasonable: dnsResult.ttl_reasonable,
        glue_records_correct: dnsResult.glue_records_correct,
        zone_transfer_axfr_disabled: dnsResult.zone_transfer_axfr_disabled,

        // Email (20)
        mx_record_present: emailResult.mx_record_present,
        mx_priority_sane: emailResult.mx_priority_sane,
        spf_record_present: emailResult.spf_record_present,
        spf_syntax_valid: emailResult.spf_syntax_valid,
        spf_mechanism_strictness: emailResult.spf_mechanism_strictness,
        spf_lookup_count_under_10: emailResult.spf_lookup_count_under_10,
        dmarc_record_present: emailResult.dmarc_record_present,
        dmarc_policy_level: emailResult.dmarc_policy_level,
        dmarc_pct_100: emailResult.dmarc_pct_100,
        dmarc_reporting_configured: emailResult.dmarc_reporting_configured,
        dmarc_alignment_mode: emailResult.dmarc_alignment_mode,
        dkim_selector_published: emailResult.dkim_selector_published,
        dkim_key_strength_adequate: emailResult.dkim_key_strength_adequate,
        bimi_record_present: emailResult.bimi_record_present,
        bimi_logo_renders_in_inbox: emailResult.bimi_logo_renders_in_inbox,
        reverse_dns_matches_smtp_banner: emailResult.reverse_dns_matches_smtp_banner,
        smtp_starttls_supported: emailResult.smtp_starttls_supported,
        smtp_open_relay_test_passed: emailResult.smtp_open_relay_test_passed,
        mta_sts_policy_published: emailResult.mta_sts_policy_published,
        tls_rpt_configured: emailResult.tls_rpt_configured,

        // TLS / web (20)
        https_enforced_no_plain_http: tlsResult.https_enforced_no_plain_http,
        http_redirect_status_code_expected: tlsResult.http_redirect_status_code_expected,
        hsts_header_present: tlsResult.hsts_header_present,
        hsts_max_age_sufficient: tlsResult.hsts_max_age_sufficient,
        hsts_preload_eligible: tlsResult.hsts_preload_eligible,
        tls_certificate_valid: tlsResult.tls_certificate_valid,
        tls_certificate_expiry_over_30d: tlsResult.tls_certificate_expiry_over_30d,
        tls_certificate_issuer_trusted: tlsResult.tls_certificate_issuer_trusted,
        tls_protocol_no_legacy_versions: tlsResult.tls_protocol_no_legacy_versions,
        weak_cipher_suites_disabled: tlsResult.weak_cipher_suites_disabled,
        ocsp_stapling_enabled: tlsResult.ocsp_stapling_enabled,
        http2_or_http3_supported: tlsResult.http2_or_http3_supported,
        server_header_hides_version: tlsResult.server_header_hides_version,
        redirect_chain_length_reasonable: tlsResult.redirect_chain_length_reasonable,
        mixed_content_absent: tlsResult.mixed_content_absent,
        robots_txt_present: tlsResult.robots_txt_present,
        sitemap_xml_present: tlsResult.sitemap_xml_present,
        error_pages_no_stack_trace_leak:
          tlsResult.error_pages_no_stack_trace_leak ?? appResult.error_responses_no_stack_trace_leak,
        compression_enabled: tlsResult.compression_enabled,
        cookies_secure_flag_set: tlsResult.cookies_secure_flag_set,

        // Headers (15)
        content_security_policy_present: headersResult.content_security_policy_present,
        x_content_type_options_nosniff: headersResult.x_content_type_options_nosniff,
        x_frame_options_or_frame_ancestors: headersResult.x_frame_options_or_frame_ancestors,
        referrer_policy_set: headersResult.referrer_policy_set,
        permissions_policy_set: headersResult.permissions_policy_set,
        cross_origin_opener_policy_set: headersResult.cross_origin_opener_policy_set,
        cross_origin_resource_policy_set: headersResult.cross_origin_resource_policy_set,
        cross_origin_embedder_policy_set: headersResult.cross_origin_embedder_policy_set,
        csp_upgrade_insecure_requests: headersResult.csp_upgrade_insecure_requests,
        csp_no_unsafe_inline_without_nonce: headersResult.csp_no_unsafe_inline_without_nonce,
        cors_not_wildcard_on_authenticated_routes:
          headersResult.cors_not_wildcard_on_authenticated_routes,
        cookies_httponly_flag_set: headersResult.cookies_httponly_flag_set,
        cookies_samesite_attribute_set: headersResult.cookies_samesite_attribute_set,
        x_xss_protection_legacy_check: headersResult.x_xss_protection_legacy_check,
        strict_transport_security_present: headersResult.strict_transport_security_present,

        // Reputation (10)
        domain_on_spam_blacklist: reputationResult.domain_on_spam_blacklist,
        hosting_ip_on_blacklist: reputationResult.hosting_ip_on_blacklist,
        whois_domain_age: reputationResult.whois_domain_age,
        whois_privacy_enabled: reputationResult.whois_privacy_enabled,
        domain_expiry_over_90d: reputationResult.domain_expiry_over_90d,
        certificate_transparency_log_reviewed: reputationResult.certificate_transparency_log_reviewed,
        no_typosquat_lookalikes_flagged: reputationResult.no_typosquat_lookalikes_flagged,
        google_safe_browsing_clean: reputationResult.google_safe_browsing_clean,
        no_malware_flags: reputationResult.no_malware_flags,
        registrar_identified: reputationResult.registrar_identified,

        // Infra (10)
        hosting_provider_identified: infraResult.hosting_provider_identified,
        dns_provider_identified: infraResult.dns_provider_identified,
        sibling_domain_same_operator: infraResult.sibling_domain_same_operator,
        cdn_waf_provider_identified: infraResult.cdn_waf_provider_identified,
        ip_geolocation_matches_target_market: infraResult.ip_geolocation_matches_target_market,
        asn_reputation: infraResult.asn_reputation,
        nameserver_single_point_of_failure_check: infraResult.nameserver_single_point_of_failure_check,
        registrar_transfer_lock_enabled: infraResult.registrar_transfer_lock_enabled,
        auto_renew_enabled: infraResult.auto_renew_enabled,
        dnssec_chain_validated_end_to_end: infraResult.dnssec_chain_validated_end_to_end,

        // App (10)
        bulk_pagination_capped: appResult.bulk_pagination_capped,
        request_signing_present: appResult.request_signing_present,
        rate_limiting_per_ip_configured: appResult.rate_limiting_per_ip_configured,
        api_keys_absent_from_client_bundle: appResult.api_keys_absent_from_client_bundle,
        sequential_id_enumeration_prevented: appResult.sequential_id_enumeration_prevented,
        error_responses_no_stack_trace_leak: appResult.error_responses_no_stack_trace_leak,
        admin_routes_require_auth: appResult.admin_routes_require_auth,
        cors_restricted_to_known_origins: appResult.cors_restricted_to_known_origins,
        source_maps_not_published_to_prod: appResult.source_maps_not_published_to_prod,
        dependency_vulnerabilities_scanned: appResult.dependency_vulnerabilities_scanned,
      };
    });

    // ---- Write evidence to R2 ----
    await step.do("write-evidence", async () => {
      const summary = {
        hostname,
        auditedAt: new Date().toISOString(),
        scores: computeScores(attrs),
        attributes: attrs,
      };
      await writeEvidenceBatch(this.env.EVIDENCE, [
        {
          key: domainEvidenceKey(domainId, "dns-result"),
          body: JSON.stringify(dnsResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "email-result"),
          body: JSON.stringify(emailResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "tls-result"),
          body: JSON.stringify(tlsResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "headers-result"),
          body: JSON.stringify(headersResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "infra-result"),
          body: JSON.stringify(infraResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "app-result"),
          body: JSON.stringify(appResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "reputation-result"),
          body: JSON.stringify(reputationResult, null, 2),
          contentType: "application/json",
        },
        {
          key: domainEvidenceKey(domainId, "summary"),
          body: JSON.stringify(summary, null, 2),
          contentType: "application/json",
        },
      ]);
    });

    // ---- Persist to D1 ----
    // Captured before the new row is inserted, so "previous" unambiguously
    // means "the latest result prior to this run" -- read again after
    // insertion would just return the row this same step is about to write.
    const previousResult = await step.do("load-previous-result", async () => {
      return getLatestAuditResult(this.env.DB, domainId);
    });

    const resultId = await step.do("persist-results", async () => {
      const scores = computeScores(attrs);
      const id = crypto.randomUUID();
      await insertDomainAuditResult(this.env.DB, id, domainId, attrs, scores);
      return id;
    });

    // ---- Diff against the previous run (self-monitoring) ----
    // Computed here, inside the workflow, rather than in a second
    // DomainAuditAgent tick -- sidesteps DO/Workflow completion timing
    // entirely, and works identically whether this run came from the
    // recurring agent or the existing manual /admin/audit-domain. Only
    // written when something actually changed -- domain_audit_diffs is
    // "what changed", not a redundant copy of every result.
    if (previousResult) {
      await step.do("compute-diff", async () => {
        const prevAttrs = JSON.parse(previousResult.attributes) as DomainAuditAttributes;
        const changedKeys = diffAttributes(prevAttrs, attrs);
        if (Object.keys(changedKeys).length > 0) {
          await insertDomainAuditDiff(this.env.DB, crypto.randomUUID(), domainId, previousResult.id, resultId, changedKeys);
        }
      });
    }

    // ---- Sibling domain edges ----
    // Link this domain to any other domain in the catalog that resolved to
    // the same IP (same operator heuristic).
    if (infraResult._resolvedIp) {
      await step.do("link-siblings", async () => {
        // Find other domains whose latest audit resolved to the same IP.
        // We search the attributes JSON column — SQLite JSON functions are
        // available in D1 via the json_extract() function.
        const { results } = await this.env.DB.prepare(
          `SELECT d.id FROM domains d
           JOIN domain_audit_results r ON r.domain_id = d.id
           WHERE d.id != ?
             AND json_extract(r.attributes, '$._resolvedIp') = ?
           GROUP BY d.id`,
        )
          .bind(domainId, infraResult._resolvedIp)
          .all<{ id: string }>();

        for (const { id } of results) {
          await linkDomainSibling(this.env.DB, domainId, id);
        }
      });
    }

    await step.do("mark-done", async () => {
      await updateDomainAuditStatus(this.env.DB, domainId, "done");
    });
  }
}
