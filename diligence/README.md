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
