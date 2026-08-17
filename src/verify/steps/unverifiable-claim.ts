export interface UnverifiableClaimResult {
  unverifiable: boolean;
  reason: string | null;
  matchedClaim: string | null;
}

// A repo whose core value proposition is "works against a specific live
// third-party service" (scrapes/reverse-engineers a named external site)
// can't have that claim verified by this pipeline -- smoke only proves
// the code installs/builds, never that it still gets past whatever the
// named target's defenses currently look like, and actually checking that
// live would mean testing a third party's production system without
// their authorization. This flags the claim honestly instead of letting
// smoke:pass imply something it didn't check.
const TARGET_VERB_PATTERN = /\b(scrapes?|reverse[- ]engineers?|bypasses?|circumvents?)\b/i;
// A bare domain-shaped token near the verb -- "scrapes Amazon" alone is
// too generic to flag (could mean "the amazon.com website" or nothing
// specific); requiring something domain-shaped keeps this from firing on
// every scraper-adjacent tool that only describes its own generic
// capability ("scrapes any website you configure").
const DOMAIN_PATTERN = /\b[a-z0-9-]+\.(com|net|org|co|io|kr|dev)\b/i;

export function detectUnverifiableClaim(claims: string[], mechanismSummary: string): UnverifiableClaimResult {
  const candidates = [...claims, mechanismSummary];
  for (const text of candidates) {
    if (TARGET_VERB_PATTERN.test(text) && DOMAIN_PATTERN.test(text)) {
      return { unverifiable: true, reason: "claims to operate against a specific named live external target", matchedClaim: text };
    }
  }
  return { unverifiable: false, reason: null, matchedClaim: null };
}
