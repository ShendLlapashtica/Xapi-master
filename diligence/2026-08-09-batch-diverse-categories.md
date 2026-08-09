# Batch: diverse categories (not crypto)

Broadening the log beyond money-bait repos, per direction: test broadly
across GitHub's actually-trending repos, not just the "hot lucrative"
crypto genre. Sourced via GitHub Search API (created recently, sorted by
stars, across several topic queries) since this pipeline has no X access
(`X_BEARER_TOKEN` unset -- confirmed live twice, see `diligence/README.md`
if that changes). 14 repos queued this batch; this file covers the ones
worth a real writeup. Full componentId list at the bottom.

## firecrawl/anydoc -- the repo Lundrimi named directly

**componentId:** `d928d8d5-ffcb-4c79-ad04-041a02ae2f4b` &middot; 12,075 stars, MIT, Rust
**Evidence:** `/evidence/d928d8d5-ffcb-4c79-ad04-041a02ae2f4b/`

This is the specific repo referenced earlier today as the team's example of
"the strongest tool for documents" -- worth verifying rather than taking on
faith. It holds up: real repository structure (`Cargo.toml`/`Cargo.lock`,
`src/`, `tests/`, `fuzz/`, `bench/`, `node/` and `python/` binding
directories, CI config), from Firecrawl (a real, known org), MIT licensed.

Classify tier read it accurately: category `document-parsing-conversion`
(the *original* fixed-enum category this whole pipeline's capability tier
was built around -- see `CAPABILITY_TIER_CATEGORY` in `src/types.ts`),
claims matching the real README (Word/PPT/Excel/OpenDocument/RTF/EPUB/CSV/
PDF -> GitHub-Flavored Markdown, "single-digit millisecond" conversion),
and a real, specific `cliInvocation`: `npx @firecrawl/anydoc {input}` --
not empty, unlike every money-bait repo tested so far.

**The gap this surfaces:** sanity passed, but smoke never ran --
`smoke:unsupported_stack`, because anydoc is Rust and this pipeline's E2B
sandbox only has a working smoke template for Node/Python so far (see
`verify-workflow.ts`'s comment on go/rust routing, and the reliability
test's `BurntSushi/ripgrep` finding in the main README). Practically: the
single most relevant repo to this project's original stated purpose
(document-parsing verification) is also the one this pipeline currently
*can't* verify past sanity+classify. Building the Rust E2B template is the
highest-leverage next infra step if "recommend anydoc" is meant to carry
real evidence, not just a claims summary.

**Prognosis:** legitimate, real tool, worth the recommendation Lundrimi
gave it -- but currently only "claims independently extracted," not
"independently proven to run," in this system's own terms. Flag that
distinction rather than overstate confidence.

## digimata/quill -- clean, narrow, honest claims

**componentId:** `9c1fbe66-110e-4f17-90cb-828eb972df9f` &middot; 3,736 stars, MIT, Swift

"Ultra-minimalist macOS recording + transcription," fully on-device (Core
Audio capture + on-device Core ML transcription, explicitly "does not send
any data off the machine" per its own claims). Also hit
`smoke:unsupported_stack` -- Swift/macOS-only, outside what a Linux-based
E2B sandbox could run regardless of template support (this one isn't a
pipeline gap, it's a real constraint: a macOS-only tool can't be verified
in a Linux microVM at all). Included here as a contrast case: narrow,
specific, technically plausible claims, no funnel, no unverifiable "proof"
screenshots -- the opposite profile from the crypto-bot entries.

## Process note: relay tunnel died again mid-run

All 12 in-flight Node/Python repos from this batch errored out identically
(`E2B relay /run failed: 530 error code: 1016`) partway through smoke --
the exact same quick-tunnel-silently-dies failure documented in the main
README's 2026-08-08 reliability test, recurring within the same day. Ran
`relay/watchdog.sh` (restarted the tunnel, verified `/health` on the new
URL before trusting it), repinned `E2B_RELAY_URL`, and re-triggered all 12
under a `-retry2` instance id, since the original instances had already
exhausted their retries and errored out terminally rather than being still
in-flight to resume automatically.

**This is now the second confirmed occurrence in ~36 hours of operation.**
A `cloudflared tunnel --url` "quick tunnel" fundamentally has no uptime
guarantee -- that's not a bug to fix, it's the documented behavior of that
specific tunnel type. The actual fix is infrastructure, not code: a named
Cloudflare Tunnel (`cloudflared tunnel create` + DNS route, backed by a
`credentials.json`) gets a stable hostname and Cloudflare's own health
handling instead of an ephemeral one that silently stops routing after an
unpredictable number of hours. Worth doing before the next extended run,
since every recurrence costs however many verification runs were in-flight
when it dies -- 12 here.

## Process note: status conflation (continued)

Both completed repos this batch hit the *same* status
(`smoke:unsupported_stack`) as the two crypto scam repos from the previous
entries, for entirely different reasons: those had zero code at all, these
have real code the sandbox just doesn't support yet. Same status string is
currently overloading two very different situations (see the first
diligence entry's process note for this exact concern, filed before there
was a second, non-crypto example of it). Worth prioritizing now that it's
recurring.

## Batch 3: chasing a new pattern -- star-farmed "AI agent skill" repos

Sourced via a parallel research pass (GitHub Search API across several
categories, grounded in real `gh api repos/{owner}/{repo}` stats, not just
search blurbs). It surfaced a pattern not seen in batches 1-2: brand-new
GitHub orgs (weeks old, single-digit repo counts, low follower counts)
whose flagship repo hits 20k-100k+ stars in 2-5 months on a codebase far
too thin to justify it -- structurally the same "hype outpaces substance"
shape as the crypto-bot entries, but in the AI-tooling space instead of
finance, and at a much larger scale (tens of thousands of stars, not
hundreds). Queued for real verification rather than judged on metadata
alone:

- `Graphify-Labs/graphify` (104,336★, Python) -- org created ~6 weeks ago, 2 repos/369 followers, 868-file/8.6MB codebase. Most extreme star-to-org-age ratio found.
- `nexu-io/open-design` (84,563★, TypeScript) -- org created Feb 2026, ~800 stars/day sustained for 3.5 months.
- `KeygraphHQ/shannon` (46,551★, TypeScript) -- claims to "execute real exploits" to prove vulnerabilities; only 31 open issues and a 241-file tree against that claimed sophistication.
- `ayghri/i-have-adhd` (18,506★, Python) -- 65 files, 270KB, 1081 forks. Most disproportionate size-to-star ratio found tonight.
- `DeusData/codebase-memory-mcp` (38,201★, C) -- buzzword-heavy pitch, but 425 open issues suggests at least some real usage -- ambiguous case, not a clean verdict either way.

Controls run alongside (established orgs, for contrast): `microsoft/fara`
(Microsoft Research), `airbytehq/airbyte` (long-established), and
`e2b-dev/open-computer-use` (built on E2B -- the same sandbox infra this
pipeline itself runs on, a genuinely interesting meta case).

## Final results (all batches)

The overnight loop stopped for ~11 hours partway through this batch (see
`project_concurrent_sessions_warning` memory / this repo's git history --
the local relay process itself died, not just the tunnel, most likely from
the machine sleeping). On return: `relay/keepalive.sh` and
`relay/watchdog.sh` both had to be restarted, not just the latter --
worth remembering that a dead `localhost:8080/health` means the relay
process is gone, not just the tunnel, and needs its own restart first.
All stragglers re-triggered and completed cleanly once the relay was back.

| Repo | Stars | Result | Note |
|---|---|---|---|
| `firecrawl/anydoc` | 12,075 | `smoke:unsupported_stack` | real Rust code, sandbox gap (see above) |
| `digimata/quill` | 3,736 | `smoke:unsupported_stack` | real Swift/macOS code, out of scope for Linux sandbox |
| `DietrichGebert/ponytail` | 98,778 | `smoke:pass` | installs cleanly -- see methodology-corrections entry on what smoke:pass does/doesn't prove |
| `vercel-labs/scriptc` | 2,995 | `smoke:pass` | real TypeScript-to-native compiler, Vercel org |
| `kirodotdev/KiroCrew` | 2,392 | `smoke:pass` | |
| `omnigent-ai/omnigent` | 8,405 | `smoke:pass` | AI agent orchestration layer, real CLI (`omnigent`) |
| `amplifthq/opentag` | 1,377 | `smoke:pass` | Slack/GitHub-triggered coding-agent dispatcher, real CLI |
| `lidge-jun/opencodex` | 8,577 | `smoke:pass` | multi-provider LLM proxy for Codex/Claude Code, real CLI |
| `trycompai/crm` | 7,762 | `smoke:fail` | installed but build/run step failed -- see evidence for exact error |
| `makecindy/cindy` | 1,910 | `smoke:fail` | |
| `f-amine/vibe-stack` | 23 | `smoke:fail` | |
| `nexu-io/open-design` | 84,563 | `smoke:fail` | the *other* extreme star/org-age outlier -- failed for real, unlike Graphify. Worth a closer look given the metadata pattern was identical to Graphify's but the outcome wasn't. |
| `DavidHDev/canvas-ui` | 3,633 | *pending* | still running as of this writing; last of the batch |
| `FlareStarter/flarestarter` | 343 | `smoke:fail` | Cloudflare-stack SaaS starter -- ironic given this pipeline runs on the same stack |
| `eurafaeldecarvalho/browser-scraper` | 9 | `smoke:fail` | |

Category graph after this batch: 30 nodes (from 1 before this session).
