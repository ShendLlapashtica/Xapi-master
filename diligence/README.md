# Diligence log

An ongoing, append-only log of "hot" repos run through the live Xapi
pipeline specifically to answer *does this actually make money / do what it
claims*, not just *does it pass CI*. Separate from the main
[README.md](../README.md)'s "Reliability test" section, which exists to
prove the pipeline itself works -- this exists to build a track record of
real findings on the repos people actually chase (crypto/trading bots,
"passive income" agents, and similar), as the evidence base for a curated,
verified recommendation stack per category. One entry per repo, one commit
per entry, oldest first below.

## Method

For each candidate:

1. Find it (trending lists, topic search, `gh api` for real stats -- stars,
   push recency, description). Prefer repos that are both *hyped* (stars,
   recent activity, "make money" framing) and *unverified* -- the ones
   nobody's actually run.
2. Feed it into the real pipeline, the same way a live X post would:
   insert a `components` row + `source_posts` row in D1, then
   `wrangler workflows trigger verification-workflow` with that
   `componentId` (mirrors `POST /admin/verify-repo` exactly --
   `discoverRepo()` in `src/extract/extract-consumer.ts` -- used here only
   because `ADMIN_TOKEN` isn't available this session; the HTTP route does
   the same two inserts + enqueue in one call whenever it's available).
3. Pull the evidence bundle for real (`/evidence/<componentId>/...` on the
   live worker, or `components` row fields) -- never assert a result
   without the evidence key that backs it.
4. Write the entry: what it claims, what tier it actually reached, the
   concrete finding, and a prognosis -- would this survive being handed to
   a client as "verified"? If not, why not, in one sentence a non-technical
   reader can act on.
5. Commit the entry on its own.

## Entries

- [2026-08-08 — Benjam1nCup/Polymarket-trading-bot-python-V2](2026-08-08-benjam1ncup-polymarket-trading-bot-python-v2.md) -- 116-star "trading bot" repo, zero source files. Verdict: marketing funnel, not software.
- [2026-08-08 — 0xalberto/polymarket-arbitrage-bot](2026-08-08-0xalberto-polymarket-arbitrage-bot.md) -- 63-star repo, README claims $500-700/day on a $200 deposit, zero source files, seller's own text admits the strategy lost money at scale. Also the first live proof the category graph (below) works end-to-end.
- [2026-08-09 — Batch: diverse categories](2026-08-09-batch-diverse-categories.md) -- broadened beyond crypto (dev tools, AI agents, SaaS starters, document tools); includes `firecrawl/anydoc` (the doc-parsing tool named directly as a recommendation -- holds up) and a live relay-tunnel outage found and fixed mid-run.
- [2026-08-09 — Pattern: reverse-engineered API wrappers](2026-08-09-pattern-reverse-engineered-apis.md) -- technique writeup (multi-proxy CORS-relay fallback against a site's own public frontend API) plus real GitHub examples spanning public-data to financial-account sensitivity.
- [2026-08-09 — Methodology corrections](2026-08-09-methodology-corrections.md) -- `smoke:pass` means "installs," not "claims verified" (found via the night's top suspicious repo, 104k stars on a 6-week-old org); empty `cliInvocation.command` means "no CLI," not always "no code" (found via a real reverse-engineered banking-API library).
- [2026-08-09 — Case study: Encar semantic model](2026-08-09-case-study-encar-semantic-model.md) -- not a repo verdict, a method: how to recover a closed API's facet taxonomy and query grammar from a real working integration, using the user's own encar.com wrapper as the worked example. New KG node: `semantic-api-reverse-engineering`.
- [2026-08-09 — Batch: no-code/games/computer-use](2026-08-09-batch-nocode-games-computeruse.md) -- 5 of 9 hit `smoke:unsupported_stack` purely on language-template gaps (Go, C++, Lua); conclusion: template coverage, not repo quality, is now the main bottleneck on verdict rate.
- [2026-08-09 — KG hierarchy + fuzzy similarity](2026-08-09-kg-hierarchy-and-similarity.md) -- category graph now a real tree (8 clades, 47 nodes backfilled), classify resolves parent clades going forward; Vectorize similarity matching added as flag-only fuzzy pattern detection alongside exact-fingerprint dedup. Both verified live against a fresh repo.
- [2026-08-09 — `category_node_id` backfill gap](2026-08-09-category-node-id-backfill-gap.md) -- `components.category` (the old flat enum) is stale and shouldn't be read as a coverage signal; 24 of 30 `other`-flagged rows already have a real leaf via `category_node_id`. The actual gap: 31 components (including several capability-tier fixtures that reached `capability:pass`) predate that column and were never backfilled -- only fresh `classify` runs populate it.
- [2026-08-09 — Batch: MCP servers](2026-08-09-batch-mcp-servers.md) -- new category, both completed results legitimate (a document-canvas tool, a Tiingo financial-data wrapper); hierarchy resolver confirmed working on a category it wasn't originally tested against.
- [2026-08-10 — anydoc, actually run (corrects earlier verdict)](2026-08-10-anydoc-manual-capability-test.md) -- ran it directly against all 5 capability-tier fixtures (Rust, so the pipeline itself can't yet): solid on native-text PDF/DOCX, but fails its own headline claim on multi-column layout detection (garbled, interleaved output). Honestly declines on scanned-OCR and HTML rather than faking a result. `smoke:pass` would have said nothing about this either way.
- [2026-08-09 — Real graph edges shipped](2026-08-09-real-graph-edges-shipped.md) -- the similarity check now persists real, queryable `component_edges` rows instead of a one-time evidence flag; threshold recalibrated 0.85 -> 0.80 from the first real cross-repo score (0.8298), verified with a live SQL join, not a demo.
- [2026-08-09 — KG cleanup: orphaned nodes removed](2026-08-09-kg-cleanup-orphaned-nodes.md) -- 8 duplicate/orphaned category nodes deleted (64 -> 56), all confirmed zero-usage and zero-reference before removal; root cause and a repeatable sweep method documented.
- [2026-08-09 — Batch: agent-internet scraping + passive-income/farming bots](2026-08-09-batch-agent-scraping-passive-income.md) -- `Agent-Reach` (69k★, "zero API fees" multi-platform scraper incl. X) smoke:pass but unverified beyond install per standing methodology correction; `1688-cli` real working Playwright automation, strongest result of the batch; `money4band` a genuine (if low-value) bandwidth-sharing orchestrator blocked on interactive-setup tooling, not dishonesty; `getgrass-bot-js` hit `smoke:unsupported_stack` despite being Node.js -- flagged as a possible stack-detection gap, resolved below.
- [2026-08-09 — Follow-up: getgrass-bot-js resolved](2026-08-09-getgrass-stack-detection-resolved.md) -- not a pipeline bug: the repo's only `package.json` is nested in a subdirectory, not root, and its "releases" are opaque `.zip` drops rather than trackable source -- the repo's structure is the anomaly, not stack-detect.ts.
- [2026-08-21 — `category_node_id` backfill, closed for real](2026-08-21-category-node-id-backfill-closed.md) -- the 2026-08-09 gap, actually fixed: new `POST /admin/backfill-category` route, 22/22 real components backfilled with genuine specific leaves (spot-checked: `black` -> `python-code-formatter`), verified live before/after (22 -> 0), not asserted. One real snag recorded: a backgrounded batch request got killed mid-run with zero output; the live row count is what caught it, not the endpoint's own response.
