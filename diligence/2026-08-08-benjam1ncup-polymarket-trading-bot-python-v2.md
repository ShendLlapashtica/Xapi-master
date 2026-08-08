# Benjam1nCup/Polymarket-trading-bot-python-V2

**Tested:** 2026-08-08 &middot; **componentId:** `7f02a5ec-964c-46e3-9b90-330ab377ecce`
**Evidence:** `https://xapi.prishtina-online.workers.dev/evidence/7f02a5ec-964c-46e3-9b90-330ab377ecce/`
**Repo at test time:** 116 stars, pushed 2026-07-29, `headSha c19d31ea68b9157c9bc4669b7d32695b277ef278`

## Why this one

Found searching for trending Polymarket/crypto "arbitrage bot" repos --
exactly the "hot, lucrative, money-bringing" category this log targets. Its
description on GitHub repeats "polymarket trading bot / polymarket
arbitrage bot / polymarket bot" roughly fifteen times verbatim, which reads
as search/discovery gaming rather than a real project description -- reason
enough on its own to put it through verification rather than take the star
count at face value.

## What it claims

Pulled straight from the classify tier (`/evidence/.../classify/response.json`),
which reads the README the same way a human skimming it would:

- Automated trading on Polymarket 5-minute prediction markets
- Real-time order-book monitoring and low-latency execution
- Arbitrage, market-making, and directional strategies ("sniper, ladder,
  stair, momentum, copy trading")
- Automatic redemption of winning positions after market resolution
- "1 week Profit" screenshots, a demo video, and a PnL-tracking account
  offered as proof

## What's actually there

```
gh api repos/Benjam1nCup/Polymarket-trading-bot-python-V2/git/trees/main?recursive=1
  -> README.md (34768 bytes)
```

That's the entire repository. One file. No `requirements.txt`, no
`pyproject.toml`, no `setup.py`, no `Pipfile`, no `.py` files at all --
nothing for any of the four stack detectors in
[`stack-detect.ts`](../src/verify/stack-detect.ts) to match.

The pipeline's own tiers confirm this independently, not just the `gh api`
listing:

| Tier | Result |
|---|---|
| Sanity | **passed** -- it's a real, public, accessible repo (`sanity/result.json`) |
| Classify | ran, extracted the claims above -- but `cliInvocation.command` came back `""`. The model was asked "what command would run this" and correctly found nothing to answer with. |
| Smoke | never reached -- `detectStackForRepo` returned `unsupported` (zero manifest files of any kind), so the workflow terminated at `smoke:unsupported_stack` per [`verify-workflow.ts:126`](../src/verify/verify-workflow.ts#L126) before ever touching the E2B sandbox |

`tier_reached: sanity`, `status: smoke:unsupported_stack` in the
`components` row. No malicious code either, for the same reason there's no
code at all -- there's nothing to run, safe or otherwise.

## The actual business model

Not a bot. The README's real content, once the screenshots are set aside,
is a content/lead-gen funnel: links to the author's Medium, Substack, and
dev.to, an offer to "buy profitable bots" or book a call, and Telegram/X/
email contact details. The repo's function is to look like proof of
capability -- profit screenshots, a "1 week Profit" gallery, a demo video --
that drives outreach to a paid product that isn't in this repo. The `V2` in
the name fits a pattern common to this genre: repost under a fresh name
after the previous one's credibility (or account) burns out, rather than
version a real codebase.

## Prognosis

**Not usable, and not verifiable as a tool -- it isn't one.** If this
surfaced in a client-facing "verified repo" recommendation on star count or
README quality alone, it would pass; running it through even the cheapest
tier (sanity + classify, no sandbox spend) catches it in under a couple of
seconds because `cliInvocation` comes back empty. That specific signal --
classify succeeding but returning no invocable command -- is a cheap,
concrete "this claims to be software but isn't" check worth trusting on its
own, separate from and earlier than a full smoke run.

## Process note for next iteration

`category` came back `orchestration` -- the least-bad fit among the current
fixed six-value enum (`document-parsing-conversion`, `ocr`, `storage`,
`retrieval`, `orchestration`, `other` -- [`types.ts:28-35`](../src/types.ts#L28-L35)),
none of which actually describes a trading bot. That enum was scoped to
BRIEF.md's original document-tooling focus; it doesn't extend to
"whatever category a hot repo happens to be in," which this log's whole
premise requires. Concrete case for moving `category` from a fixed enum to
an open, LLM-suggested, hierarchical taxonomy (parent categories with
sub-categories -- e.g. `trading > prediction-markets > arbitrage`) so
category-scoped search/pre-filtering doesn't force-fit every new domain
into `other`.

`smoke:unsupported_stack` currently means three different things under one
label: (a) go/rust repos with real code but no E2B template yet (see the
comment at `verify-workflow.ts:117-125`), (b) a repo in some other
unhandled language, and (c) this case -- no source files at all. (a) and
(b) are "can't test yet"; (c) is "there's nothing here." Worth distinguishing
explicitly (e.g. a component-level flag off `cliInvocation.command === ""`)
next time this comes up often enough to justify the schema change --
tracked here rather than changed silently in this pass, since it's a
verdict-semantics change, not a bug fix.
