# Xapi

Implementation of [BRIEF.md](BRIEF.md). Everything below assumes you've read
that first -- this is the "how to actually run it" doc, not the design doc.

**Live deployment:** `https://xapi.prishtina-online.workers.dev` -- `GET /`
shows current status, including which secrets are actually configured.

## Known deviations from BRIEF.md

Two decisions were made after the brief was signed off, both driven by cost
and account-access constraints discovered during deployment, not by a
change of design intent:

- **Classify tier runs on Groq, not Anthropic.** `src/verify/groq-client.ts`
  replaces the brief's Claude/Anthropic choice, calling Groq's free-tier,
  OpenAI-compatible `chat/completions` endpoint with structured outputs
  (`response_format: json_schema, strict: true`) so the model is
  constrained to the exact `Classification` shape -- no markdown-fence
  parsing or malformed-JSON reprompting needed. Model is
  `openai/gpt-oss-120b`, configurable via `GroqClientOptions.model`.
- **No X API access.** X's pricing makes this a real recurring cost with no
  free tier, and that purchase was declined -- see "X integration" below
  for what runs instead.

## X integration

**Not the official API -- a self-hosted client on `rettiwt-api`, using a
dedicated account's own logged-in session.** `src/listener/x-client.ts`
talks to the same internal endpoints x.com's own web app uses, authenticated
as a real account rather than through a paid developer key. This is the
same category of tool as `agent-twitter-client`/`twikit`/etc: real,
maintained-ish, widely used for exactly this -- not something built from
scratch here.

**Be clear-eyed about what this is:** it's against X's Terms of Service,
the same way most unofficial-API scraping is against most platforms' ToS.
It isn't the kind of thing that invites a lawsuit at this scale, but the
account doing it can get rate-limited or suspended -- which is exactly why
this should run as a **dedicated, secondary** account, never your main one.

**Setup — the one real credential this needs:**
1. Log into X as the dedicated account in a normal browser.
2. DevTools → Application (or Storage) → Cookies → `x.com` → copy the
   `auth_token`, `ct0`, and `twid` values.
3. Build a cookie string: `auth_token=...; ct0=...; twid=...`
4. Encode it (one-off, run locally with `node`):
   ```js
   const { AuthService } = require("rettiwt-api");
   console.log(AuthService.encodeCookie("auth_token=...; ct0=...; twid=..."));
   ```
5. `wrangler secret put X_SESSION_TOKEN` and paste the encoded value.

Until that's set, `ListenerAgent.poll()` checks for `X_SESSION_TOKEN` and
no-ops quietly rather than erroring every 15 minutes forever -- the
recurring schedule keeps running so polling starts on its own the moment a
token is set, no extra bootstrap step needed. `POST /admin/verify-repo`
remains the manual fallback either way: it runs the exact same discover →
dedupe → enqueue-verification path a live post's link would have hit (see
`src/extract/extract-consumer.ts`'s `discoverRepo()`, shared by both
paths).

**Dependency security, checked not assumed:** `rettiwt-api`'s transitive
deps pulled in `axios`/`form-data` versions with real, current CVEs
(SSRF, prototype pollution, an unsafe boundary-randomness bug) at install
time -- confirmed via `npm audit`, not skipped. Pinned to patched versions
via `package.json`'s `overrides` (`axios` ^1.19.0, `form-data` ^4.0.6);
`npm audit` reports zero vulnerabilities as of this writing. Re-run it
after any `npm update` touching this dependency tree -- a session token is
real account access, worth the extra minute.

**Seed the tracked accounts** (no numeric id resolution needed anymore --
searches go by username directly):
```bash
WORKER_URL=https://xapi.<subdomain>.workers.dev ADMIN_TOKEN=... npm run seed:accounts
```
then `POST /admin/listener/start` once to bootstrap the Durable Object's
recurring poll (it's lazy -- needs one manual hit after deploy/token-set).

**Known-fragile, honestly:** X ships frontend changes regularly, and any of
them can rotate internal GraphQL query IDs or invalidate a session without
notice -- when that happens, polling goes silent (no new posts, no error),
not loud. `rettiwt-auth`/`rettiwt-core` (transitive deps) are themselves
flagged deprecated on npm as of this writing; `rettiwt-api` itself is
still actively published. Also confirmed live (2026-08-09): a transitive
dependency (`rettiwt-auth` → `https-proxy-agent`, a default-import against
a named-exports-only package) fails to load under this project's own test
runner (`@cloudflare/vitest-pool-workers`), even though it loads fine in
the real deployed Worker (verified directly via `wrangler dev`) -- the
test for `pollAccounts` mocks the `rettiwt-api` module rather than relying
on that import chain, see the comment in `src/listener/x-client.test.ts`.
The actual live network path (a real search call against a real session)
has not been exercised yet -- that only becomes possible once a real
`X_SESSION_TOKEN` exists.

## Reliability test — 2026-08-08

A live, no-mocks pass through the pipeline, run specifically to answer "does
this actually work" rather than take it on faith. Five fresh end-to-end
runs, one real infra bug found mid-test and fixed live, one real code bug
found and fixed live. Nothing here is simulated -- every result below is a
real Workflow instance and a real evidence bundle you can pull with the
`componentId`.

**1. A previously-unverified repo, from scratch.**
[`ShendLlapashtica/papirun-pr-main`](https://github.com/ShendLlapashtica/papirun-pr-main)
(TypeScript/Vite, no license, no description) went in as a brand-new
component. Sanity passed, classify correctly read it as a Lovable-scaffolded
React app (category `other`, not a document-parsing tool), stack detection
correctly picked `node`, and smoke passed for real
(`componentId 78fe4ca7-35c6-4e09-8bf2-78e19e57dee7`, evidence under
`/evidence/78fe4ca7-35c6-4e09-8bf2-78e19e57dee7/`).

**2. A real infra bug, caught by that same run.** Smoke initially failed
every retry with `E2B relay /run failed: 530 error code: 1016` -- a
Cloudflare Tunnel edge error, not a repo or code problem. Root cause: the
local `cloudflared` quick tunnel (see "Known deviations") had been up
~18 hours and silently stopped routing while the process kept running --
sanity and classify (which don't touch the relay) kept working the whole
time, so this was invisible until something actually needed smoke/capability.
Fixed live: restarted the tunnel, verified the new URL's `/health` directly
before trusting it, repinned `E2B_RELAY_URL`, and the *same* Workflow
instance picked up the fix on its next scheduled retry and completed
successfully -- no new run needed. See `relay/watchdog.sh` for the manual
(intentionally not auto-scheduled -- see the script's own comment) fix
procedure if this happens again; the tell is that exact error string.

**3. Reproducibility check on a known failure.** Re-ran `chroma-core/chroma`
(previously `smoke:fail`) after the tunnel fix, to make sure its original
failure was a real finding and not an artifact of the same broken tunnel.
It failed identically both times with the identical underlying error
(`httpx.ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING]` during `pip`
metadata generation) -- confirming this is a genuine, reproducible egress-
allowlist block (chroma's build needs hosts beyond PyPI), not noise.

**4. Sanity-tier rejection path.** A fabricated repo URL
(`ShendLlapashtica/this-repo-does-not-exist-xapi-test`) correctly failed
sanity in under a second with `"reason":"repository not found"` -- confirms
the first gate actually gates.

**5. A real code bug, found via `BurntSushi/ripgrep` (Rust).** Stack
detection correctly found `Cargo.toml` and identified `rust` -- but no
custom E2B template for Rust has been built yet (needs Docker locally, see
"Known follow-ups"), so smoke reached the relay and got an opaque
`502`/"template not found", which would have recorded as `smoke:fail` --
indistinguishable from an actual build failure of the repo's own code. That
was a real false-negative risk, not a hypothetical one. Fixed in
`src/verify/verify-workflow.ts`: `go`/`rust` are now routed to
`smoke:unsupported_stack` (the same honest status already used when no
stack is detected at all) instead of being attempted and misreported.
Redeployed and confirmed live on the same failing instance.

**What this does and doesn't tell you.** It confirms the tiering logic,
status transitions, evidence writing, and isolation model all behave
correctly under real conditions, including two real bugs that only a live
run would surface. It does not make the local-relay-tunnel arrangement a
permanent fix -- that's still the single biggest operational risk in this
system (see "Known deviations" and `relay/README.md`); today's incident is
exactly the failure mode that goes away once the relay runs as a real
Cloudflare Container instead of a local process behind a quick tunnel.

## Architecture at a glance

- **Cloudflare Worker** (`src/index.ts`) -- one deployable script exporting
  a `fetch` handler, a `queue` handler, and three classes:
  - `ListenerAgent` (`src/listener/`) -- Agents SDK Durable Object, polls X
    every 15 minutes when `X_BEARER_TOKEN` is set (see above).
  - `VerificationWorkflow` (`src/verify/`) -- one durable run per
    newly-discovered repo: sanity → classify → smoke → capability.
  - `E2bRelayContainer` (`src/sandbox/relay-container.ts`) -- fronts
    `relay/`, invoked below.
- **`relay/`** -- a small standalone Node service, deployed as a Cloudflare
  Container. It exists because E2B's command-execution API is gRPC, which
  Workers' `fetch` can't speak -- see [`relay/README.md`](relay/README.md)
  for the full explanation. This is the one piece of the system that
  genuinely can't run as a plain Worker.
- **D1** (`migrations/`) -- the `components`/`source_posts`/`accounts` catalog.
- **R2** -- evidence bundles under `evidence/`, capability-tier fixture
  inputs under `fixtures/`.
- **Queues** -- `raw-posts` (Listener → Extract) and `verify-requests`
  (Extract → Workflow).

## First-time setup

1. **Install dependencies**
   ```bash
   npm install
   cd relay && npm install && cd ..
   ```

2. **Run the test suite** (needs zero credentials -- see "What's tested
   without live credentials" below)
   ```bash
   npm test
   npm run typecheck
   ```

3. **Create Cloudflare resources**
   ```bash
   wrangler d1 create xapi-catalog        # paste the returned database_id into wrangler.jsonc
   wrangler r2 bucket create xapi-evidence   # requires R2 enabled once via the dashboard first
   wrangler queues create raw-posts
   wrangler queues create raw-posts-dlq
   wrangler queues create verify-requests
   wrangler queues create verify-requests-dlq
   wrangler d1 migrations apply xapi-catalog --remote
   ```

4. **Upload the capability-tier fixtures** -- see [`fixtures/README.md`](fixtures/README.md).

5. **Set secrets**
   ```bash
   wrangler secret put GITHUB_TOKEN
   wrangler secret put GROQ_API_KEY
   wrangler secret put E2B_API_KEY          # forwarded into the relay container, see src/sandbox/relay-container.ts
   wrangler secret put RELAY_SHARED_SECRET  # generate a long random value; the relay needs the identical value, see relay/README.md
   wrangler secret put ADMIN_TOKEN          # gates /admin/* routes
   # X_BEARER_TOKEN: optional, only if you've bought X API access -- see "Known deviations" above
   ```

6. **Deploy**
   ```bash
   npm run deploy
   ```
   This builds and pushes `relay/Dockerfile` as part of deploying the
   Worker (it's declared in `wrangler.jsonc`'s `containers` array) -- needs
   Docker running locally. Without Docker, deploy everything else with
   `wrangler deploy --containers-rollout=none`; the sanity/classify tiers
   work fine, smoke/capability need the container.

7. **Feed a repo in** -- since there's no X access, use the manual route
   instead of the account-roster/listener flow:
   ```bash
   curl -X POST https://xapi.<your-subdomain>.workers.dev/admin/verify-repo \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"repoUrl": "https://github.com/owner/repo"}'
   ```
   (If you *do* have X access: fill in `seed/accounts.seed.json`, run
   `npm run seed:accounts`, then `POST /admin/listener/start` to bootstrap
   the DO's recurring poll -- Durable Objects are lazy, so this needs one
   manual hit after deploy.)

## Querying the catalog

```bash
curl "https://xapi.<your-subdomain>.workers.dev/components?category=document-parsing-conversion&status=capability:pass"
```

## What's tested without live credentials

`npm test` covers, with zero X/GitHub/Groq/E2B credentials and no
Cloudflare account:
- Every pure-logic module (URL canonicalization, stack detection, the
  capability-tier scoring/majority-verdict logic, status/tier transitions,
  egress-allowlist computation, CLI-invocation templating).
- D1/R2/Queue-touching code (`components-repo`, `evidence-store`,
  `extract-consumer`, the `/components` and `/admin` routes, the
  `ListenerAgent`'s poll logic) via `@cloudflare/vitest-pool-workers`'s
  local Miniflare simulation.
- Request-construction and response-parsing for the X/GitHub/Groq clients,
  against hand-written canned JSON fixtures with an injected `fetch`
  (Groq's included live: the structured-output schema was verified against
  the real API during development, see `src/verify/groq-client.ts`).

Not covered, and not coverable until you have real accounts/Docker: actual
network calls to X/GitHub, the `relay/` container's real gRPC round-trip to
E2B, whether the egress allowlist actually blocks what it should, and a
true end-to-end extract → verify cycle. See `relay/README.md`'s "What to
verify once you have a real E2B account" section.

## Known follow-ups

- **The relay tunnel is a single point of failure.** It's a local process
  behind a Cloudflare quick tunnel with no uptime guarantee (see
  "Reliability test" above for a real incident). Run
  `bash relay/watchdog.sh` if smoke/capability start failing with `E2B
  relay /run failed` -- it diagnoses and restarts the tunnel, then prints
  the one command to repin `E2B_RELAY_URL` (deliberately not automatic --
  see the script's own comment). The real fix is moving `relay/` onto the
  Cloudflare Container it's already declared as, or any other
  Docker-capable host.
- `src/sandbox/templates/README.md` -- the four E2B sandbox templates need
  to be built once via the E2B CLI; their generated names need to line up
  with what `relay/src/e2b-run.ts` passes as `Sandbox.create(template, ...)`.
  Until then, `go`/`rust` repos correctly stop at
  `smoke:unsupported_stack` (see "Reliability test" above) rather than
  being attempted.
- `src/index.ts`'s duplicate-workflow-id detection matches on error message
  text as a heuristic -- confirm the live Workflows API's actual error
  shape and tighten it once you can.
- Cloudflare Workers Paid plan is needed to set an explicit
  `limits.cpu_ms` in `wrangler.jsonc` (see the comment there) -- deploy
  works fine on Free without it since Workflow steps are I/O-bound, but
  add it back if CPU-bound work (unlikely here) ever needs headroom.
