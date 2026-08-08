import type { FixtureResult, MajorityVerdict } from "../types";

// Aggregates the five capability-fixture results into a tier verdict, per
// BRIEF.md §2: majority-based rather than perfect-score, with `undetermined`
// reserved for "we never trust our own invocation guess" — distinct from a
// tool that actually ran and produced nothing usable.
export function computeMajorityVerdict(results: FixtureResult[]): MajorityVerdict {
  if (results.length === 0) {
    throw new Error("computeMajorityVerdict requires at least one fixture result");
  }

  const usableCount = results.filter((r) => r.outcome === "usable").length;
  if (usableCount >= 3) return "capability:pass";
  if (usableCount >= 1) return "capability:partial";

  const allInvocationErrors = results.every((r) => r.outcome === "invocation_error");
  return allInvocationErrors ? "capability:undetermined" : "capability:fail";
}
