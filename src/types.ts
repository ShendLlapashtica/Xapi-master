// Shared types for the catalog data model, queue payloads, and workflow contracts.
// See BRIEF.md for the design these encode.

// Type-only imports -- erased at compile time, so these don't create real
// circular module dependencies at runtime even though both modules import
// Env from here.
import type { ListenerAgent } from "./listener/listener-agent";
import type { DomainAuditAgent } from "./audit/domain-audit-agent";
import type { E2bRelayContainer } from "./sandbox/relay-container";

export type TierReached = "none" | "sanity" | "smoke" | "capability";

// tier:outcome pairs. `smoke:pass` is terminal for every category except
// `document-parsing-conversion`, which is the only category with a capability
// harness in this PoC.
export const COMPONENT_STATUSES = [
  "discovered",
  "sanity:fail",
  "smoke:fail",
  "smoke:unsupported_stack",
  "smoke:pass",
  "capability:pass",
  "capability:partial",
  "capability:fail",
  "capability:undetermined",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const CATEGORIES = [
  "document-parsing-conversion",
  "ocr",
  "storage",
  "retrieval",
  "orchestration",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Only this category has a real capability-tier fixture harness in the PoC.
export const CAPABILITY_TIER_CATEGORY: Category = "document-parsing-conversion";

// --- Category graph ("subclades") ---
//
// Open-ended and hierarchical, additive alongside the fixed `Category` enum
// above (which stays exactly as-is -- it gates the capability tier via
// CAPABILITY_TIER_CATEGORY and changing what it can contain would change
// that gate). Built from the classify tier's `suggestedCategory` field: an
// LLM-suggested name, not constrained to the fixed list, so a domain the
// enum was never scoped for (e.g. a trading bot) gets a real node instead
// of being force-fit into "other" or "orchestration". `parent_id` is ready
// for nesting (subclades) but nothing currently assigns it -- new nodes
// land at the top level until a curation/nesting step exists.
export interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export type Stack = "node" | "python" | "go" | "rust";
export type StackDetection = Stack | "unsupported";

// --- Queue payloads ---

export interface RawPostMessage {
  postId: string;
  postUrl: string;
  authorHandle: string;
  authorUserId: string;
  postedAt: string; // ISO 8601
  // entities.urls[].expanded_url from the *effective* tweet: the original
  // tweet's URLs when this post is a repost, resolved via the
  // referenced_tweets/includes.tweets expansion.
  urls: string[];
}

// Queue body AND Workflow params — same shape, passed straight through.
export interface VerifyRequestParams {
  componentId: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
}

// --- Classify step ---

export interface CliInvocation {
  command: string; // e.g. "docparse convert {input} -o {output}"
  outputMode: "stdout" | "file";
  outputPathTemplate: string | null; // e.g. "{basename}.md"; null when outputMode === "stdout"
}

export interface Classification {
  category: Category;
  // Open-ended companion to `category` above -- see "Category graph" --
  // an LLM-suggested name not limited to the fixed CATEGORIES list.
  suggestedCategory: string;
  // Which existing top-level clade `suggestedCategory` nests under (or a
  // new one to create if none fit) -- the subclade hierarchy. See
  // groq-client.ts's prompt for how the existing-clade list is supplied.
  suggestedParentClade: string;
  claims: string[];
  mechanismSummary: string;
  cliInvocation: CliInvocation;
  rawResponseEvidenceKey: string;
}

// --- Capability tier ---

export type FixtureId =
  | "text-native-pdf"
  | "scanned-image-pdf"
  | "multi-column-pdf"
  | "docx"
  | "html";

export type FixtureOutcome = "usable" | "unusable" | "invocation_error";

export type StructuralElement = "table" | "heading";

export interface FixtureExpectedProfile {
  fixtureId: FixtureId;
  file: string; // key under fixtures/ in R2
  minWordCount: number;
  expectedStructures: StructuralElement[];
}

export interface FixtureResult {
  fixtureId: FixtureId;
  outcome: FixtureOutcome;
  exitCode: number | null;
  command: string;
  wordCount: number | null;
  detectedStructures: StructuralElement[];
  evidenceKey: string; // R2 key of the full bundle for this fixture
  durationMs: number;
}

export type MajorityVerdict =
  | "capability:pass"
  | "capability:partial"
  | "capability:fail"
  | "capability:undetermined";

// --- D1 row shapes ---

export interface AccountRow {
  id: number;
  handle: string;
  x_user_id: string | null;
  added_at: string;
}

export interface ComponentRow {
  id: string;
  name: string;
  repo_owner: string;
  repo_name: string;
  repo_url: string;
  category: Category | null;
  category_node_id: string | null;
  claims: string | null; // JSON-encoded string[]
  mechanism_summary: string | null;
  cli_invocation: string | null; // JSON-encoded CliInvocation
  readme_fingerprint: string | null;
  duplicate_of_component_id: string | null;
  tier_reached: TierReached;
  status: ComponentStatus;
  evidence_prefix: string;
  discovered_at: string;
  verified_at: string | null;
  commit_sha_checked: string | null;
}

// Persisted graph edges -- see components-repo.ts's createEdge/
// getEdgesForComponent. Directional in storage, conceptually symmetric for
// "similar_to".
export interface ComponentEdgeRow {
  id: string;
  from_component_id: string;
  to_component_id: string;
  relationship_type: string;
  score: number;
  created_at: string;
}

export interface SourcePostRow {
  id: number;
  component_id: string;
  post_id: string;
  post_url: string;
  author_handle: string;
  posted_at: string;
}

// --- API contract ---

export interface ComponentsQueryParams {
  category?: Category;
  status?: ComponentStatus;
  limit?: number;
  cursor?: string;
}

export interface ComponentSummaryDTO {
  id: string;
  name: string;
  repo: { owner: string; name: string; url: string };
  category: Category | null;
  categoryNode: { id: string; name: string; parentId: string | null } | null;
  duplicateOfComponentId: string | null;
  claims: string[];
  mechanismSummary: string | null;
  tierReached: TierReached;
  status: ComponentStatus;
  commitShaChecked: string | null;
  discoveredAt: string;
  verifiedAt: string | null;
  evidence: { prefix: string; links: string[] };
  sourcePosts: Array<{ postUrl: string; authorHandle: string; postedAt: string }>;
}

export interface ComponentsResponse {
  components: ComponentSummaryDTO[];
  nextCursor: string | null;
}

// --- Domain / website nodes ---

export type DomainAuditStatus = "discovered" | "auditing" | "done" | "error";

export interface DomainRow {
  id: string;
  hostname: string;
  audit_status: DomainAuditStatus;
  last_audited_at: string | null;
  discovered_at: string;
  // D1 stores this as 0/1 (SQLite has no native boolean) -- callers get the
  // raw integer back via `SELECT *`, same as every other row type here that
  // doesn't hand-map columns.
  watched: number;
  watched_at: string | null;
}

// Typed object covering all 100 security attributes defined in the brief.
// null = attribute could not be determined (probe error / missing data).
export interface DomainAuditAttributes {
  // DNS fundamentals (15)
  a_record_present: boolean | null;
  aaaa_record_present: boolean | null;
  ns_record_count: number | null;
  ns_provider_diversity: boolean | null;
  soa_serial_format_valid: boolean | null;
  soa_refresh_value_sane: boolean | null;
  soa_retry_value_sane: boolean | null;
  soa_expire_value_in_range: boolean | null;
  soa_minimum_ttl_sane: boolean | null;
  caa_record_present: boolean | null;
  caa_restricts_issuance: boolean | null;
  dnssec_enabled: boolean | null;
  ttl_reasonable: boolean | null;
  glue_records_correct: boolean | null;
  zone_transfer_axfr_disabled: boolean | null;

  // Email / SMTP (20)
  mx_record_present: boolean | null;
  mx_priority_sane: boolean | null;
  spf_record_present: boolean | null;
  spf_syntax_valid: boolean | null;
  spf_mechanism_strictness: "hard_fail" | "soft_fail" | "neutral" | "missing" | null;
  spf_lookup_count_under_10: boolean | null;
  dmarc_record_present: boolean | null;
  dmarc_policy_level: "none" | "quarantine" | "reject" | "missing" | null;
  dmarc_pct_100: boolean | null;
  dmarc_reporting_configured: boolean | null;
  dmarc_alignment_mode: string | null;
  dkim_selector_published: boolean | null;
  dkim_key_strength_adequate: boolean | null;
  bimi_record_present: boolean | null;
  bimi_logo_renders_in_inbox: boolean | null;
  reverse_dns_matches_smtp_banner: boolean | null;
  smtp_starttls_supported: boolean | null;
  smtp_open_relay_test_passed: boolean | null;
  mta_sts_policy_published: boolean | null;
  tls_rpt_configured: boolean | null;

  // Web server / TLS (20)
  https_enforced_no_plain_http: boolean | null;
  http_redirect_status_code_expected: boolean | null;
  hsts_header_present: boolean | null;
  hsts_max_age_sufficient: boolean | null;
  hsts_preload_eligible: boolean | null;
  tls_certificate_valid: boolean | null;
  tls_certificate_expiry_over_30d: boolean | null;
  tls_certificate_issuer_trusted: boolean | null;
  tls_protocol_no_legacy_versions: boolean | null;
  weak_cipher_suites_disabled: boolean | null;
  ocsp_stapling_enabled: boolean | null;
  http2_or_http3_supported: boolean | null;
  server_header_hides_version: boolean | null;
  redirect_chain_length_reasonable: boolean | null;
  mixed_content_absent: boolean | null;
  robots_txt_present: boolean | null;
  sitemap_xml_present: boolean | null;
  error_pages_no_stack_trace_leak: boolean | null;
  compression_enabled: boolean | null;
  cookies_secure_flag_set: boolean | null;

  // Security headers (15)
  content_security_policy_present: boolean | null;
  x_content_type_options_nosniff: boolean | null;
  x_frame_options_or_frame_ancestors: boolean | null;
  referrer_policy_set: boolean | null;
  permissions_policy_set: boolean | null;
  cross_origin_opener_policy_set: boolean | null;
  cross_origin_resource_policy_set: boolean | null;
  cross_origin_embedder_policy_set: boolean | null;
  csp_upgrade_insecure_requests: boolean | null;
  csp_no_unsafe_inline_without_nonce: boolean | null;
  cors_not_wildcard_on_authenticated_routes: boolean | null;
  cookies_httponly_flag_set: boolean | null;
  cookies_samesite_attribute_set: boolean | null;
  x_xss_protection_legacy_check: boolean | null;
  strict_transport_security_present: boolean | null;

  // Reputation / blacklist (10)
  domain_on_spam_blacklist: boolean | null;
  hosting_ip_on_blacklist: boolean | null;
  whois_domain_age: number | null;       // days; null if unresolvable
  whois_privacy_enabled: boolean | null;
  domain_expiry_over_90d: boolean | null;
  certificate_transparency_log_reviewed: boolean | null;
  no_typosquat_lookalikes_flagged: boolean | null;
  google_safe_browsing_clean: boolean | null;
  no_malware_flags: boolean | null;
  registrar_identified: string | null;   // e.g. "Namecheap, Inc."

  // Infrastructure / ownership (10)
  hosting_provider_identified: string | null;  // e.g. "Amazon.com, Inc., AS16509"
  dns_provider_identified: string | null;
  sibling_domain_same_operator: boolean | null;
  cdn_waf_provider_identified: string | null;  // e.g. "Cloudflare", "Vercel"
  ip_geolocation_matches_target_market: boolean | null;
  asn_reputation: "good" | "neutral" | "bad" | null;
  nameserver_single_point_of_failure_check: boolean | null;
  registrar_transfer_lock_enabled: boolean | null;
  auto_renew_enabled: boolean | null;
  dnssec_chain_validated_end_to_end: boolean | null;

  // App-layer hygiene (10)
  bulk_pagination_capped: boolean | null;
  request_signing_present: boolean | null;
  rate_limiting_per_ip_configured: boolean | null;
  api_keys_absent_from_client_bundle: boolean | null;
  sequential_id_enumeration_prevented: boolean | null;
  error_responses_no_stack_trace_leak: boolean | null;
  admin_routes_require_auth: boolean | null;
  cors_restricted_to_known_origins: boolean | null;
  source_maps_not_published_to_prod: boolean | null;
  dependency_vulnerabilities_scanned: boolean | null;
}

export interface DomainAuditResultRow {
  id: string;
  domain_id: string;
  audited_at: string;
  score_total: number;
  score_dns: number | null;
  score_email: number | null;
  score_tls: number | null;
  score_headers: number | null;
  score_reputation: number | null;
  score_infra: number | null;
  score_app: number | null;
  attributes: string; // JSON-encoded DomainAuditAttributes
}

export interface DomainComponentEdgeRow {
  id: string;
  domain_id: string;
  component_id: string;
  relationship: string;
  created_at: string;
}

export interface DomainSiblingEdgeRow {
  id: string;
  domain_a_id: string;
  domain_b_id: string;
  relationship: string;
  created_at: string;
}

// Workflow input
export interface DomainAuditWorkflowParams {
  domainId: string;
  hostname: string; // canonical, no scheme, no trailing slash
}

// --- API contract (domain) ---

export interface DomainSummaryDTO {
  id: string;
  hostname: string;
  auditStatus: DomainAuditStatus;
  lastAuditedAt: string | null;
  discoveredAt: string;
  latestAudit: {
    scoreTotal: number;
    scoreDns: number | null;
    scoreEmail: number | null;
    scoreTls: number | null;
    scoreHeaders: number | null;
    scoreReputation: number | null;
    scoreInfra: number | null;
    scoreApp: number | null;
    auditedAt: string;
  } | null;
}

export interface DomainsQueryParams {
  limit?: number;
  cursor?: string;
}

export interface DomainsResponse {
  domains: DomainSummaryDTO[];
  nextCursor: string | null;
}

// --- Env ---

export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  RAW_POSTS: Queue<RawPostMessage>;
  VERIFY_REQUESTS: Queue<VerifyRequestParams>;
  LISTENER_AGENT: DurableObjectNamespace<ListenerAgent>;
  VERIFICATION_WORKFLOW: Workflow<VerifyRequestParams>;
  // The E2B command-execution relay, see src/sandbox/relay-container.ts and
  // relay/README.md for why this hop exists.
  E2B_RELAY: DurableObjectNamespace<E2bRelayContainer>;
  // Optional override: when set, src/sandbox/e2b-client.ts calls this plain
  // HTTPS URL instead of the E2B_RELAY container binding -- e.g. a
  // Cloudflare Tunnel to a relay running outside Cloudflare entirely.
  E2B_RELAY_URL: string;

  // rettiwt-api's encoded session cookie for a dedicated X account (see
  // src/listener/x-client.ts and README.md's "X integration" section) --
  // NOT an official API key, no purchase involved. Optional/empty until
  // set; ListenerAgent.poll() no-ops gracefully rather than erroring when
  // it's blank.
  X_SESSION_TOKEN: string;
  GITHUB_TOKEN: string;
  // Classify tier runs on Groq (free tier, OpenAI-compatible structured
  // outputs), not the brief's original Anthropic choice -- see
  // src/verify/groq-client.ts and README.md.
  GROQ_API_KEY: string;
  E2B_API_KEY: string;
  ADMIN_TOKEN: string;
  RELAY_SHARED_SECRET: string;
  // Fuzzy pattern matching alongside the exact-match README fingerprint --
  // see src/verify/embeddings.ts.
  AI: Ai;
  README_EMBEDDINGS: VectorizeIndex;
  DOMAIN_AUDIT_WORKFLOW: Workflow<DomainAuditWorkflowParams>;
  DOMAIN_AUDIT_AGENT: DurableObjectNamespace<DomainAuditAgent>;
  // Kill switch for the X-posting approve flow (src/api/posts-route.ts) --
  // checked fresh on every approve call, same mechanism as X_SESSION_TOKEN
  // (wrangler secret put, no redeploy). Absent/not "true" -> posting is off,
  // even if a draft exists and X_SESSION_TOKEN is set.
  X_POSTING_ENABLED: string;
}
