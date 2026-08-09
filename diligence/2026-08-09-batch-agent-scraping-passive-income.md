# Batch: agent-internet scraping + passive-income/farming bots

Four repos, sourced via `gh api` topic/keyword search biased toward Node/Python
stacks (per the template-coverage bottleneck already logged). All four reached
a terminal or near-terminal tier; none needed a second cycle to get a real
verdict.

## Panniantong/Agent-Reach -- `smoke:pass`, category `agent-internet-capability-layer`

69,421 stars, pushed within the last 3 days at time of testing. Claims:
"Give your AI agent eyes to see the entire internet. Read & search Twitter,
Reddit, YouTube, GitHub, Bilibili, XiaoHongShu -- one CLI, zero API fees."
Mechanism, per classify: it installs its own CLI, checks the host
environment, and for each supported platform selects the first working
backend from a prioritized list (yt-dlp, feedparser, a Twitter CLI, etc.) --
it's a router/installer over other people's scraping tools, not a novel
scraping engine itself.

`smoke:pass` here means `agent-reach install --env=auto` ran cleanly --
**not** that "zero API fees" access to Twitter/Reddit/etc. actually works,
per the standing correction in
[2026-08-09-methodology-corrections.md](2026-08-09-methodology-corrections.md):
smoke tier isn't a functional check outside `document-parsing-conversion`.
Worth naming plainly given this project's own history: "zero API fees" access
to X specifically almost certainly means the same category of session-cookie
scraping this project's other, separately-owned X integration already uses,
which is against X's ToS regardless of whose code does it. Not verified
further -- out of this session's scope to test X access at all, by design.

**Prognosis:** legitimate-looking router/installer, star count consistent
with genuine recent virality rather than an obvious bot-star pattern, but the
core "zero API fees, works everywhere" claim is unverified and the mechanism
(wrapping other scrapers) means its real reliability is whatever the weakest
wrapped backend's ToS tolerance is. Not verifiable as "does what it claims"
without testing the individual backends -- flag as unverified, not as broken.

## MRColorR/money4band -- `smoke:fail`, category `bandwidth-passive-income-orchestrator`

430 stars. Claims a Docker-compose stack aggregating real bandwidth-sharing
apps (Honeygain, EarnApp, IPRoyal Pawns, PacketStream, Peer2Profit, and
others) that pay for shared idle internet bandwidth, plus a web dashboard.
Unlike the crypto "trading bot" entries earlier in this log, this is not a
zero-file marketing shell -- it's real Python (`python3 main.py`) orchestrating
real, named third-party services that do genuinely pay out (a legitimate, if
low-value, category of "passive income" -- selling your own bandwidth, not a
fabricated trading strategy). It failed smoke regardless: the entrypoint needs
interactive setup/Docker access this environment's smoke tier doesn't provide.

**Prognosis:** plausible/real mechanism, verdict blocked on tooling not on
the repo's honesty -- worth a retry with a smoke path that tolerates
interactive setup, rather than writing it off as vaporware.

## superjack2050/1688-cli -- `smoke:pass`, category `1688-product-supplier-scraper-cli`

55 stars. Drives a real Chrome browser via Playwright (persistent profile +
background daemon) against 1688.com for product/supplier search, pre-sale
inquiries, cart/checkout, and order tracking, returning JSON when piped.
Real, working automation (`1688 search "佛龛柜" --max 10` is a genuine,
non-trivial `cliInvocation`, not a placeholder). Smoke tier passing on a
Playwright-based tool is a stronger signal than on a plain install -- it means
the CLI itself ran, not just that dependencies resolved.

**Prognosis:** the strongest result of tonight's batch. A real, usable
dropshipping/sourcing automation tool doing exactly what its README claims at
the tier tested.

## cmalf/getgrass-bot-js -- `smoke:unsupported_stack`, category `grass-node-mining-bot`

526 stars. Automates Grass Network airdrop mining: logs in, rotates
HTTP/SOCKS proxies, holds WebSocket connections open, "mines" automatically.
Notable: this is a Node.js script per its own README and classify's
`mechanism_summary`, yet it hit `smoke:unsupported_stack` -- the stack
detector didn't recognize it as a supported Node project (worth a follow-up
look at whether this repo's layout -- entry point location, missing/unusual
`package.json` fields -- is exposing a real gap in stack detection distinct
from the already-logged Go/Rust/Lua template gap, since this one claims to be
exactly the stack this pipeline is supposed to support).

**Prognosis:** can't verdict the actual mining/proxy-rotation claims until
the stack-detection question above is resolved -- currently a tooling gap,
not evidence against the repo.
