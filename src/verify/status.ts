import { CAPABILITY_TIER_CATEGORY, type Category, type ComponentStatus, type TierReached } from "../types";

// tier_reached tracks the highest tier *cleared*, not attempted — a sanity
// failure leaves it at "none" (BRIEF.md §2: "recorded as verification_tier:
// none"), and smoke:unsupported_stack leaves it at "sanity" since smoke was
// never actually run.
export function tierForStatus(status: ComponentStatus): TierReached {
  switch (status) {
    case "discovered":
    case "sanity:fail":
      return "none";
    case "smoke:fail":
    case "smoke:unsupported_stack":
      return "sanity";
    case "smoke:pass":
      return "smoke";
    case "capability:pass":
    case "capability:partial":
    case "capability:fail":
    case "capability:undetermined":
      return "capability";
  }
}

// A status is terminal (workflow stops, row is final) unless it's the
// pre-verification "discovered" placeholder, or it's smoke:pass for the one
// category that still has a capability tier to run.
export function isTerminalStatus(status: ComponentStatus, category: Category | null): boolean {
  if (status === "discovered") return false;
  if (status === "smoke:pass" && category === CAPABILITY_TIER_CATEGORY) return false;
  return true;
}

// A terminal smoke:pass (i.e. outside CAPABILITY_TIER_CATEGORY, where
// nothing further ever runs) is a real result that's easy to over-read as
// "verified" -- diligence log precedent: Graphify-Labs/graphify (104k
// stars, 6-week-old org) and KeygraphHQ/shannon (claims to autonomously
// execute exploits against live web apps) both sit at smoke:pass with
// nothing else checked (diligence/2026-08-09-methodology-corrections.md).
// The decisionChain reasoning string is the only place in the evidence
// trail that says what this status does and doesn't mean, so it says so
// explicitly rather than relying on a reader having also read xapi.md.
export function smokeReasoning(passed: boolean, exitCode: number | null, terminal: boolean): string {
  if (!passed) return `build exited ${exitCode ?? "non-zero"}`;
  if (terminal) {
    return "build exited 0 -- confirms the code installs/builds; capability-tier fixtures don't exist for this category, so functional claims are unverified";
  }
  return "build exited 0";
}
