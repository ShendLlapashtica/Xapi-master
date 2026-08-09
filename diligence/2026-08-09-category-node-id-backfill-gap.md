# Methodology correction: `components.category` is stale; the real gap is `category_node_id`, and it has no backfill path

Started as a request to "broaden the KG" by reclassifying the `other`-labeled
components out of the catch-all. The premise was wrong, caught before acting
on it, which is itself worth recording.

## The false lead: `components.category = 'other'` looks like 30/70 components are uncategorized

`components.category` is the *original* fixed enum (`CAPABILITY_TIER_CATEGORY`
in `src/types.ts` still gates on it) -- additive alongside it, per
`migrations/0002_category_graph.sql`, is `category_node_id`, a pointer into
the real hierarchical `categories` tree. Querying only `category` and seeing
30 rows say `other` looks like a coverage gap. It isn't one:

```sql
SELECT comp.name, cat.name AS real_leaf
FROM components comp JOIN categories cat ON comp.category_node_id = cat.id
WHERE comp.category = 'other';
```

24 of those 30 already have a specific, correctly-assigned leaf --
`browser-scraper` -> `stealth-browser-automation`, `getgrass-bot-js` ->
`grass-node-mining-bot`, `1688-cli` -> `1688-product-supplier-scraper-cli`,
`shannon` -> `ai-autonomous-pentester`, and 20 more, each a real, specific
node, not a generic bucket. `category` just never got updated when
`category_node_id` was introduced -- it's legacy, not a live signal.

**Correction for future entries:** judge KG coverage by `category_node_id`,
never by `category`. The latter only still matters for the one place it's
actually read: `CAPABILITY_TIER_CATEGORY` gating.

## The real gap: 31 components have no `category_node_id` at all, some past `capability:pass`

Same query inverted (`category_node_id IS NULL`) surfaces 31 rows -- and
it's not the discovered-but-unverified repos you'd expect. Breakdown by
`tier_reached`/`status`:

| tier_reached | status | n |
|---|---|---|
| smoke | smoke:pass | 9 |
| none | discovered | 6 |
| sanity | smoke:fail | 5 |
| capability | capability:fail | 3 |
| none | sanity:fail | 3 |
| sanity | smoke:unsupported_stack | 3 |
| capability | capability:partial | 1 |
| capability | capability:pass | 1 |

14 of the 31 reached `smoke` or `capability` -- including `markitdown`
(Microsoft, `capability:pass`), `pypdf`, `pdfplumber`, `docling`,
`unstructured`, and well-known infra libraries (`langchain`, `celery`,
`redis-py`, `qdrant-client`, `weaviate-python-client`, `click`, `black`).
These are not thin or obscure repos with missing READMEs -- `classify` in
`src/verify/verify-workflow.ts` only runs `if (readmeText)` (line 191), so a
missing README was the first hypothesis, and it's wrong for this set: these
are among the most heavily-documented Python packages that exist.

The more consistent explanation: these are old rows, several of them
capability-tier fixture baselines (R2's `EVIDENCE` bucket comment in
`wrangler.jsonc` calls this out directly: "capability-tier fixture inputs"),
predating `category_node_id`'s introduction. The hierarchy backfill in
`beb1cc4` ("Give the category graph real hierarchy instead of a flat node
list") rebuilt the `categories` node *tree* from historical flat-category
strings -- it did not backfill the `category_node_id` *pointer* on
already-terminal `components` rows. Only a fresh `classify` run (i.e., a
newly-discovered repo going through the workflow for the first time)
populates it. A component that reached `smoke:pass` or `capability:pass`
before that feature shipped is verified, useful, evidence-backed catalog
data -- and permanently uncategorized in the graph unless something
explicitly re-runs classify against it.

**Candidate heuristic, not yet acted on:** a backfill pass that re-runs just
the classify step (readme fetch -> fingerprint dedup -> `findOrCreateCategoryNode`
-> `updateComponentClassification`) against the 31 orphaned rows, reusing
`findComponentByReadmeFingerprint` first so famous repos like `click`/`black`
that certainly match an existing template elsewhere in the catalog don't
each cost a fresh Groq call. Left undone tonight -- touches 31 pre-existing
rows this session didn't create, which is a bigger, more deliberate change
than the sourcing/verification/diligence-writeup scope this session is
actually running under.
