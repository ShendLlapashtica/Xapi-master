# Xapi — Automated Discovery & Validation of Open-Source Components

**PoC brief — proposed design, scope, and answers to open questions**

---

## The one-paragraph version

Xapi is a pipeline that watches a short list of X accounts, pulls out any post that points at a GitHub repo, reads the repo well enough to know what it claims to be, and then actually runs the thing — in an isolated, throwaway machine that never touches anything of yours — to see if the claim holds up. Everything it finds, pass or fail, lands in a small SQL catalog with the evidence attached, queryable over one HTTP endpoint. Cloudflare (Workers, Agents, Workflows, Queues, D1, R2) runs the listening, orchestration, and storage. Code execution happens off Cloudflare, in disposable Firecracker microVMs (E2B), because "run whatever a stranger's repo tells you to run" and "share infrastructure with everything else you own" are two things that shouldn't be in the same trust boundary.

---

## 1. Architecture

<pre class="mermaid">
flowchart LR
    X["X accounts (10–20 tracked)"] -->|"search/recent, every 15 min"| L["ListenerAgent — Durable Object"]
    L -->|"new post found"| Q1[["Queue: raw-posts"]]
    Q1 --> E["Extract — find GitHub link, canonicalize, dedupe"]
    E -->|"new repo"| Q2[["Queue: verify-requests"]]
    E -->|"repo already known"| DB[("D1: components")]
    Q2 --> WF["Verification Workflow — one run per repo"]
    WF -->|"1. sanity check"| GH["GitHub API"]
    WF -->|"2. classify"| CL["Claude — reads README"]
    WF -->|"3. smoke, 4. capability"| SB[["E2B microVM — clone, build, run fixtures"]]
    GH -->|"exists, license, activity"| WF
    CL -->|"category, claims, mechanism"| WF
    SB -->|"exit code, stdout, output files"| WF
    WF -->|"record + evidence pointer"| DB
    WF -->|"logs, outputs, fixtures"| R2[("R2: evidence/")]
    API["GET /components?category=…"] --> DB
</pre>

*Everything left of the microVM is Cloudflare. The microVM is the one component deliberately kept off it.*

| Stage | Cloudflare primitive | Why this one |
|---|---|---|
| Listen | **Agents SDK** (`ListenerAgent`, a Durable Object) | Needs durable cursor state (`since_id`) and a self-renewing schedule (`this.schedule()`); a DO is the only Workers primitive with both built in. |
| Detect & extract | **Queue consumer Worker** | Decouples "a post arrived" from "we're now doing repo work" — a burst of 5 posts at once doesn't block or drop anything. |
| Verify | **Workflows** | Multi-step, runs for minutes (install + build + fixture runs), needs per-step retry without re-running earlier steps, and — critically — you pay for active compute, not for time spent waiting on the sandbox's HTTP response. |
| Store | **D1** | The catalog is relational by nature (components, source posts, many-to-many); "give me category=X, status=pass" is a `WHERE` clause, not a vector search. |
| Evidence | **R2** | Build logs and fixture outputs are unstructured blobs, some non-trivial in size — wrong shape for D1 rows. |
| Serve | **Worker (HTTP)** | It's one `GET` route over D1. |

---

## 2. The pipeline, stage by stage

### Listen
One `ListenerAgent` instance holds the whole account roster (seeded into D1 from your list) and wakes itself every 15 minutes. Rather than one API call per account, it issues a single `GET /2/tweets/search/recent` with a compound query — `(from:user1 OR from:user2 OR … OR from:user20) -is:reply`, requesting `expansions=referenced_tweets.id,author_id` and `tweet.fields=entities,created_at` — and a `since_id` cursor it keeps in its own storage. One call covers the whole roster; reposts are included by not excluding retweets, and because a repost's URLs live on the *original* tweet object, the `referenced_tweets` expansion is what actually gets you the link. Zero new posts since last poll = zero billed reads.

### Detect & extract
A Queue consumer looks at each new post's `entities.urls[].expanded_url`, matches against `github.com/{owner}/{repo}`, and canonicalizes (strips `.git`, trailing slashes, query strings, collapses monorepo sub-paths to the root repo while keeping the sub-path as metadata). If the canonical repo is already in D1, the post is recorded as an additional source and the pipeline stops there — no re-verification storm every time someone reshares a popular tool. If it's new, a `components` row is inserted with status `discovered` and a message goes on the `verify-requests` queue.

### Understand
Inside the Workflow, before any code runs: fetch the README via the GitHub Contents API, hand it to Claude with a fixed taxonomy (document parsing/conversion, OCR, storage, retrieval, orchestration, other) and ask for category, a short claims list, a plain-language "how it does it," and — importantly — the verbatim usage/CLI examples from the README's Quick Start section. That last part isn't just descriptive; it's the input to the Capability tier below.

### Verify — three tiers, each one gates the next
| Tier | What it checks | Where it runs | A pass means | A fail means |
|---|---|---|---|---|
| **Sanity** | Repo resolves, isn't an empty scaffold, has *some* commit history beyond an initial commit, has a license or a substantive README | GitHub REST API (no code execution) | The thing is real, not a placeholder | Stop here — recorded as `verification_tier: none`, reason attached |
| **Smoke** | Installs / builds cleanly from a pinned commit SHA | Fresh E2B microVM, stack-matched template (node / python / go / rust, chosen from `package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml`) | Build exits 0 within a 5-minute budget | Recorded as `smoke: fail` with full stdout/stderr — unless the stack isn't one of the four supported templates, in which case it's `smoke: unsupported_stack`, explicitly *not* a failure |
| **Capability** | Runs the tool against fixed category fixtures and checks the output | Same microVM, category-specific harness | See below | Recorded as `capability: fail` or `capability: undetermined` — different things, see §4 |

**Capability tier, concretely, for document parsing/conversion:** five fixture inputs live in R2 — a text-native PDF, a scanned/image PDF, a multi-column PDF, a DOCX, and an HTML page — each with a hand-written expected profile (minimum extractable word count, whether it should detect a table or heading). The Claude-inferred CLI invocation from the Understand step is run against each fixture. A run counts as *usable* if it exits 0, produces non-empty output, and the output clears the fixture's minimum word-count/structure bar. **Tier verdict is majority-based, not perfect-score:** ≥3/5 usable → `pass`, 1–2/5 → `partial`, 0/5 but the tool *ran* → `fail`, and if the inferred invocation itself errored before reaching the tool's own code → `undetermined` (we're not confident we invoked it right — that's not evidence the tool is broken). Every fixture's exact command, stdout, output file, tool commit SHA, and timestamp is written to R2 and linked from the D1 row. That bundle *is* the evidence the acceptance criteria ask for.

### Store & serve
`components` (name, repo, category, claims, mechanism summary, tier reached, status, evidence pointer, discovered/verified timestamps, commit SHA checked) plus `source_posts` (repo → post URL, author, posted-at, many-to-one). One route: `GET /components?category=document-parsing-conversion&status=pass` returns the catalog rows with tier/status and links into the evidence.

---

## 3. Platform choice

**Orchestration & storage: Cloudflare**, as asked — Agents SDK for the stateful listener, Queues for decoupling, Workflows for the durable multi-step verification run, D1 + R2 for the catalog and evidence. This is a good fit on its own merits, not just because it was requested: nothing here needs a long-lived server, the load is bursty and low-volume, and Workflows' "you don't pay while waiting on someone else's API" billing model matters when a chunk of every run is "wait for the sandbox to finish building."

**Execution: off Cloudflare, on E2B (Firecracker microVMs).** I looked at Cloudflare's own Sandbox SDK first, since keeping everything on one platform is simpler — it's a real option and worth reconsidering once this graduates past PoC. I didn't pick it because it runs on Containers, which is shared-kernel (Docker/runc-style) isolation. That's a reasonable boundary for code an *agent* wrote, or code from a source you already trust. It's a materially weaker boundary for code from a repo that appeared on the internet an hour ago and that you're choosing to build specifically *because* you don't yet know if it's legitimate. E2B's microVMs give each run its own kernel — a real hardware-virtualized boundary, the same class of isolation Lambda uses — plus a mature SDK, per-second billing that suits bursty PoC-scale traffic, and template snapshots for pre-baking the four language runtimes. The orchestrator (Workflow) talks to it over plain HTTPS; nothing about the design couples to a specific sandbox vendor, so this is a swappable decision, not a load-bearing one.

---

## 4. Answers to your questions

**1. How do you get the posts, and what does it cost?**
X retired tiered subscriptions for new developers in Feb 2026 in favor of pay-per-use: $0.005 per post read, $0.010 per user read, capped at 2M reads/month, no minimum subscription. [Filtered stream and full-archive search aren't available on pay-per-use](https://docs.x.com/x-api/getting-started/pricing) — you'd need the legacy Pro tier ($5,000/mo) or an Enterprise contract for those, which is wildly disproportionate for 10–20 accounts. So: poll, don't stream. One `search/recent` call every 15 minutes covering the whole roster with a `since_id` cursor, billed only for posts actually returned. At ~20 accounts posting a few times a day each, that's on the order of a few hundred to a couple thousand billed reads a month — **roughly $10–40/month**, with the range depending mostly on how chatty the accounts turn out to be and how many "resources" (author/media expansions included) a single search call bills as, which I'd want to confirm empirically in week one rather than assume.

**2. How do you safely run code that showed up an hour ago — what can the sandbox never touch?**
Never: your Cloudflare account, GitHub PAT, or Anthropic key — those live only in the orchestrating Worker's secrets and are never passed into the sandbox environment. Never: the open internet — egress is allowlisted per run to the repo's own git remote plus the one package registry its detected stack needs (npm, PyPI, crates.io, Go proxy), nothing else. Never: inbound connections of any kind. Never: another run's filesystem or a second use of the same VM — every sandbox is provisioned fresh from a clean template and destroyed after, success or failure, with no persistent disk. And never unbounded: hard CPU, memory, disk, and wall-clock ceilings mean a malicious `postinstall` script (fork bomb, miner, network scanner) gets capped and killed rather than left running. Every command and its full output is captured regardless of outcome, so an actual compromise attempt becomes evidence in the record rather than a silent event.

**3. How do you decide a capability check *passed* — for a doc-to-markdown converter, say?**
Not on a binary "did it run." Five fixed fixtures with hand-written expected profiles (minimum extractable word count, expected structural elements), a majority threshold (≥3/5 usable) rather than a perfect score, and a fourth outcome — `undetermined` — for when the invocation we guessed at (from the README's own usage examples) never actually reached the tool's code. That last bucket matters: without it, a tool we failed to *invoke* correctly looks identical to a tool that's actually broken, which is exactly the kind of false negative that would make you stop trusting the catalog.

**4. What's the false-positive story — hyped post, abandoned or vaporware repo?**
Three independent nets, each catching a different failure mode. Sanity catches the placeholder repo — no real commit history, no license, nothing behind the README. Smoke catches the classic "polished demo video, code that doesn't build" pattern — if `npm ci` or `pip install` fails, it fails regardless of how good the pitch was. Capability catches the subtler one: it builds fine and produces nothing usable when you actually run it against real input. None of these are silently dropped — a repo that fails at any tier is a catalog row with `status: fail` and the evidence for *why*, which is what you asked for explicitly and is also just more useful than a bookmark.

**5. What breaks first, run unattended for a month?**
My honest bet: the *link layer*, not the verification logic. Verification tiers are deterministic checks with explicit fail states — they degrade loudly. Link extraction degrades quietly: a repo gets renamed or transferred, a URL shortener resolves differently, someone links a docs site instead of the repo directly, and the pipeline just... doesn't catalog it, with no error anywhere. Second most likely: an X API contract change (a field renamed, an auth token needing rotation) breaking the Listener silently until nothing new shows up. The mitigation for both is the same and cheap: a dead-man's-switch check — "have we seen *any* new post from *any* tracked account in the last N days" — alerting on absence, not just on errors, since the failure mode here is silence.

**6. Timeline and what gets cut first?**
**2.5–4 weeks**, assuming X API and E2B accounts are already approved and funded before day one (that approval queue, not the engineering, is the actual variance in this range). If scope needs to shrink, the first thing to go is automatic CLI-invocation inference for the Capability tier — replace it with a small hand-written adapter per tool as it's discovered. That's the single highest-effort, highest-uncertainty piece, and cutting it doesn't touch the acceptance criteria: you still get 5 self-discovered, self-verified entries with real evidence and honest failures, just with one step that's semi-manual until it's earned the right to be automated.

---

## 5. PoC scope → acceptance, mapped directly

| Your acceptance criterion | How this design satisfies it |
|---|---|
| A qualifying post published while the system is running ends up cataloged, no human involved | Listener polls on a schedule independent of any manual trigger; the entire chain from post → queue → workflow → D1 row fires on its own |
| Every entry carries evidence you can read | Every tier writes its raw command + output to R2, linked from the D1 row; nothing is a bare pass/fail flag |
| A failing component is recorded as failed, not dropped | `components` rows are written at `discovered` and updated in place — a sanity or smoke failure is a terminal status, not a deleted row |
| The query endpoint returns a category's entries with verification status | `GET /components?category=…` reads directly off the schema above |

Nothing here requires more than the one category (document parsing/conversion) or more than ~20 accounts to prove — which is deliberate; the fixture harness is the part worth getting right once before it's asked to generalize.

---

## Where this lives

Nothing is built yet — this is the brief. The empty project folder at `Xapi/` is ready for the actual Workers/Workflows code once you've had a look at this and either signed off or redirected it.
