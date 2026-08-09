// Shared types for the catalog data model, queue payloads, and workflow contracts.
// See BRIEF.md for the design these encode.

// Type-only imports -- erased at compile time, so these don't create real
// circular module dependencies at runtime even though both modules import
// Env from here.
import type { ListenerAgent } from "./listener/listener-agent";
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
}
