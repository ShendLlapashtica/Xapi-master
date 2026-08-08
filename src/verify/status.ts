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
