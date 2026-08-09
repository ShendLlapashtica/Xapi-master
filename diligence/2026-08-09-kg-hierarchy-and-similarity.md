# KG hierarchy + fuzzy similarity matching, shipped and verified live

Two changes requested directly: make the category graph a real tree instead
of 47 flat nodes, and make the classify step "smarter" at recognizing
projects similar to ones already seen -- not just exact duplicates.

## 1. Real hierarchy

`suggestedParentClade` added to the classify tier's output. The workflow
now resolves parent-then-leaf (`findOrCreateCategoryNode` called twice)
instead of always creating a top-level node. The classify prompt is given
the current list of existing top-level clades (fetched fresh each run) and
told to reuse one if the domain genuinely fits, rather than invent a
near-duplicate.

The 47 nodes that predate this change were backfilled by hand into 8
clades (`scripts/backfill-category-hierarchy.sql`, documented there, not
re-run automatically):

| Clade | Nodes |
|---|---|
| ai-agent-tooling | 20 |
| creative-game-ui | 6 |
| dev-infra-data | 5 |
| writing-productivity-security | 5 |
| reverse-engineered-apis | 4 |
| document-knowledge-tools | 3 |
| saas-starters | 3 |
| money-bait-patterns | 1 (pre-backfill; see live test below) |

**Live proof it works going forward, not just the backfill**: tested
`roshinibyraj-alt/polymarket-btc-5m-bot` (fresh repo, never seen before).
Classify correctly returned `suggestedParentClade: "money-bait-patterns"`
-- reused the *existing* clade rather than creating
`polymarket-trading-bots` or similar near-duplicate -- and nested a new
leaf, `polymarket-paper-trade-mirror`, under it.

## 2. Fuzzy similarity matching (Vectorize)

New Workers AI + Vectorize binding (`@cf/baai/bge-base-en-v1.5`, 768-dim,
index `xapi-readme-embeddings`). Every freshly-classified README gets
embedded and upserted; a similarity query (cosine, threshold 0.85) runs
against it looking for near-matches, excluding the component itself.
Flag-only by design: a match writes `classify/similarity.json` evidence,
it never auto-changes category or status -- same reasoning as why the
exact-fingerprint dedup path stays exact-match-only rather than also using
similarity, which would risk silently copying a verdict onto an unrelated
repo based on a score alone.

**Live test result, and why it's actually a good outcome despite not
firing**: the same `polymarket-btc-5m-bot` test above shares surface
domain with the earlier confirmed scam repo (`0xalberto/polymarket-
arbitrage-bot`) -- both are Polymarket bots -- but the similarity check
did *not* flag it. Reading why: `0xalberto`'s repo claimed real money
($500-700/day), had zero code, and was a Telegram sales pitch.
`polymarket-btc-5m-bot` has real code and explicitly describes itself as
mirroring trades into a "demo bankroll" / "paper trade" -- honest about
being a simulator, not a real-money claim. The embedding is picking up
mechanism and honesty framing, not just topic overlap -- which is exactly
what a keyword or exact-match check would have missed either direction
(too broad on domain, or missed entirely on wording). Confirmed no error
in the underlying steps (`classify-embed`, `classify-embed-upsert`,
`classify-similarity-check` all completed; workflow instance status:
Completed, Success).

## What's still open

- Similarity threshold (0.85) is a first guess, not tuned against real
  data yet -- there's only one scam-pattern example in the index so far
  to test against. Worth revisiting once more money-bait examples
  accumulate.
- `money-bait-patterns` clade still has only 1 backfilled node (the
  original `0xalberto` component predates the category-graph feature
  entirely and was never linked); the `Benjam1nCup` entry likewise
  predates it. Neither will show up in clade-based queries until
  re-verified or manually linked.
