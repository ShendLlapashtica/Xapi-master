# `category_node_id` backfill, closed for real

Follow-up to [2026-08-09 — `category_node_id` backfill
gap](2026-08-09-category-node-id-backfill-gap.md), which found the gap and
explicitly left it undone ("touches 31 pre-existing rows this session
didn't create, a bigger, more deliberate change than the scope this session
is running under"). Picked back up tonight as part of a coordinated backlog
pass alongside a peer session on the same working tree.

## What actually shipped

Not a one-off SQL fix. A real, reusable admin route:
`POST /admin/backfill-category { componentIds: string[] }`
(`src/api/admin-route.ts`, `src/verify/backfill-category.ts`), so the same
gap reopening later (it will -- any component classified before some future
schema change will have the same shape of hole) has a rerunnable fix, not
tribal knowledge.

Deliberately narrow, matching the original entry's proposed heuristic
exactly: fetch README, fingerprint, check for an existing duplicate first
(reuse its `category_node_id`, zero Groq cost), otherwise run a real
classify call and `findOrCreateCategoryNode`. Does **not** touch
`tier_reached`/`status`/smoke/capability results, and does **not** run the
embedding/similarity-edge step classify normally does -- that's a separate
concern (connecting to the graph) from the one this closes (having a
category at all).

## Live count vs. the original entry

Original entry (2026-08-09): 31 orphaned rows, 14 past `smoke`/`capability`.
Re-queried live tonight before touching anything: **27** orphaned overall,
**22** in the actual target set (`category_node_id IS NULL AND category IS
NOT NULL AND claims IS NOT NULL` -- i.e. genuinely reached classify once,
not the 5 that are still `discovered`/`sanity:fail` and were never in scope
for this). The 9-row drop between the two counts is normal churn: fresh
discoveries since 2026-08-09 populate the field naturally going forward.

## Result: 22/22, verified live, not asserted

```sql
-- before: 22
-- after:  0
SELECT COUNT(*) FROM components
WHERE category_node_id IS NULL AND category IS NOT NULL AND claims IS NOT NULL;
```

Spot-checked one for real rather than trusting the row count alone:
`black` (the Python formatter) -> leaf `python-code-formatter`, real and
specific, not a generic bucket -- exactly the failure mode the *other*
methodology-corrections entry warned about (`category = 'other'` looking
like a coverage gap when the real leaf was fine all along). This backfill
produces real leaves, not placeholders.

## One real snag, worth recording plainly

Ran the batch in two passes. The first (21 components, backgrounded)
came back `[killed]` with zero output -- no HTTP status, no partial JSON.
Cause unconfirmed (not this session's own action, and no human input landed
on this session either); the live D1 count showed 15 of the 21 had already
succeeded server-side before whatever killed the client connection. Re-ran
the remaining 6 in the foreground this time and got a clean, fully-visible
response for all of them. Noting the failure mode here rather than only the
happy path: a batched admin endpoint like this one is vulnerable to a
killed client severing an in-flight request with no record of exactly where
it stopped -- the row-count-before/after check is what actually caught it,
not the endpoint's own response. A future version of this route worth
considering: report progress incrementally (e.g. one evidence write per
row) rather than a single response at the end of the whole batch, so a
killed client doesn't lose visibility into partial progress.
