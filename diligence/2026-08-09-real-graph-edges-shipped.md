# The graph is now actually a graph -- persisted edges, not a one-time check

Direct response to a fair critique: the "cousin" similarity feature
shipped earlier only ever ran a live Vectorize query at classify time and
wrote a flag to an evidence file. Nothing was saved. There was no way to
ask "what's connected to this component" after that moment passed --
which means it wasn't a knowledge graph, it was a lookup that evaporated.

## What shipped

**`component_edges` table** (`migrations/0005_component_edges.sql`): real
rows, `from_component_id`, `to_component_id`, `relationship_type`,
`score`. `createEdge()` / `getEdgesForComponent()` in
`components-repo.ts`. `verify-workflow.ts`'s similarity-check step now
writes a real edge for every match above threshold, not just an evidence
file.

## Live proof, not a demo

Tested against a real new repo, `hanshaze/Awesome-Prediction-Market-
Trading-Tools` (190 stars, single-file README, same zero-code shape as
the earlier confirmed scams). Queried Vectorize directly
(`wrangler vectorize query --vector-id`) for the raw scores rather than
trust the filtered result:

```
fde39548 (self)                                    0.9999987
578befaa  polymarket-btc-5m-bot                     0.8298    <- closest real match
eacd9b82  tiingo-financial-data-mcp-server          0.7545
1d774c11  getgrass-bot-js                           0.7348
8d55631f  money4band                                0.7195
```

The closest real match (0.8298, two different short-interval crypto
trading tools) sat just under the original 0.85 threshold -- which was a
guess made before any real cross-repo pair existed to test it against.
Lowered to **0.80** based on this actual number, comfortably above the
0.75 ceiling of the genuinely-different tools in the same query.

The edge is now a real, queryable row:

```sql
SELECT e.score, c1.repo_owner || '/' || c1.repo_name as from_repo,
       c2.repo_owner || '/' || c2.repo_name as to_repo
FROM component_edges e
JOIN components c1 ON e.from_component_id = c1.id
JOIN components c2 ON e.to_component_id = c2.id;

-- 0.8298 | hanshaze/Awesome-Prediction-Market-Trading-Tools | roshinibyraj-alt/polymarket-btc-5m-bot
```

No live embedding call needed to answer that -- it's stored.

## What this doesn't claim

One real edge is one real edge, not a validated system. The threshold
(0.80) is calibrated against exactly one genuine cross-repo pair --
worth revisiting every time a new one shows up, not treated as settled.
And this is still a single relationship type (`similar_to` by embedding
distance) -- a real knowledge graph with typed relationships (CLAIMS,
USES_TECHNIQUE, CONTAINS) is a bigger, separate piece of work, not
implied by this one.
