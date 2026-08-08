# 0xalberto/polymarket-arbitrage-bot

**Tested:** 2026-08-08 &middot; **componentId:** `da61ac4c-be2e-4777-8abb-cdc87940e4be`
**Evidence:** `https://xapi.prishtina-online.workers.dev/evidence/da61ac4c-be2e-4777-8abb-cdc87940e4be/`
**Repo at test time:** 63 stars, pushed 2025-12-24, no license
**Category node:** `crypto-trading-bot` (new top-level node, first entry to land there --
first live proof the [category graph](#process-note) actually works)

## Why this one

Same search as the [Benjam1nCup entry](2026-08-08-benjam1ncup-polymarket-trading-bot-python-v2.md)
-- GitHub's description for this repo reads "Search Polymarket arbitrage
opportunities in both single-market and multi-market events," which sounded
like a genuinely different, more substantive project (older, no keyword-
spammed description, plausible feature description). Worth checking whether
it holds up better under verification than the first one did.

## What it claims

From the classify tier (`/evidence/.../classify/response.json`):

- "Automated trading bot for 15-minute BTC market"
- "Simulates backtesting using historical price data"
- **"Claims to generate up to $500-$700 per day from a $200 deposit"**

That last one is worth sitting with: $500-700/day on $200 is 250-350% *daily*.
Compounded, that's not a trading strategy, it's a number nobody who has
actually run capital through it would write down.

## What's actually there

The GitHub description ("Polymarket arbitrage... single-market and
multi-market events") doesn't match the README at all -- the README never
mentions Polymarket. It opens with:

> ### Strategy is for sale. ###
> ## Contact me if you want to buy ##
> Telegram: @soladity

...followed by eleven screenshots captioned "PNL" (unverifiable -- a
screenshot of a number is not evidence of a working strategy) and a
first-person "Story" section that is, in its own words, an admission the
thing doesn't reliably work:

> "I thought if I run this bot in btc, sol, eth, xrp, I would get about 2k
> daily, so I updated bot to run in those several markets... When I woke up,
> I noticed that bot is losing money with new strategy, so I stopped bot...
> I will be constantly updating my strategy after holiday."

Repo tree is one file: `README.md`. No code, same as the first entry.
Pipeline results, independently:

| Tier | Result |
|---|---|
| Sanity | **passed** |
| Classify | ran, extracted the claims above; `cliInvocation.command` again came back `""` |
| Smoke | never reached -- `smoke:unsupported_stack` (no manifest files) |

## Prognosis

**Same verdict as the first entry, independently arrived at:** not
software, a lead-gen page for a Telegram sale, this time with an explicit,
self-reported track record of the strategy failing when scaled up. The
GitHub description ("Polymarket arbitrage") appears to be unrelated
boilerplate/SEO text pasted over a README for a different, unrelated bot
pitch -- worth noting for anyone trusting the description field alone
without reading the README, which is exactly what the classify tier's
README-based extraction is for.

## Process note

This is the second repo in the log, and the first one run after the
category graph shipped (schema + open-ended `suggestedCategory` field --
see the [Benjam1nCup entry](2026-08-08-benjam1ncup-polymarket-trading-bot-python-v2.md)'s
process note for why that was needed, and `src/types.ts`'s "Category
graph" comment for the implementation). It worked end-to-end on the first
real run: `category` still correctly returned `other` (no fixed-enum
category fits a trading bot), while `suggestedCategory` returned
`crypto-trading-bot` and `findOrCreateCategoryNode` created that as a real
node (`027c5ac0-4931-453e-b55d-eb755512bc11`) -- the first node in what's
meant to become a real category tree. If the Benjam1nCup entry gets
re-verified later, it should land on this same node rather than creating a
duplicate.
