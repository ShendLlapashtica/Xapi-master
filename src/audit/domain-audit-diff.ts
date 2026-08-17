import type { DomainAuditAttributes } from "../types";

export type AttributeDiff = Record<string, { from: unknown; to: unknown }>;

// Pure comparison over the two ~100-key attribute objects from consecutive
// domain_audit_results rows. Only keys whose value actually changed are
// included -- an unchanged attribute carries no signal for a self-monitoring
// check, and domain_audit_diffs rows only get written when this returns
// something non-empty (see domain-audit-workflow.ts's compute-diff step).
export function diffAttributes(
  prev: DomainAuditAttributes,
  curr: DomainAuditAttributes,
): AttributeDiff {
  const diff: AttributeDiff = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]) as Set<keyof DomainAuditAttributes>;

  for (const key of keys) {
    const from = prev[key];
    const to = curr[key];
    if (from !== to) {
      diff[key as string] = { from, to };
    }
  }

  return diff;
}
