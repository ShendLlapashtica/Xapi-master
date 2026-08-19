# What Xapi sends to third parties

Xapi's verify and domain-audit pipelines call external services as part of
their normal operation. This is the boundary contract: what leaves Xapi,
to whom, why, and what isn't covered yet. Written because nothing in this
repo said this explicitly before -- every call below already existed in
code; this just names it in one place instead of leaving it scattered
across `src/verify/` and `src/audit/`.

## Verify pipeline (repo checks)

| Destination | What's sent | Why |
|---|---|---|
| `api.github.com`, `raw.githubusercontent.com` | repo owner/name, commit SHA, file paths/contents | fetching README, tree, and file contents to run sanity/danger/secrets checks -- see `src/verify/github-client.ts`. This is the repo's own origin; GitHub already knows about its own public repos. |
| `api.groq.com` | full README text | classify tier's LLM call -- see `src/verify/groq-client.ts`. The README is whatever the repo author published; if a README quotes or names a client/vendor, that text goes to Groq as part of the prompt. No filtering happens before the call. |
| E2B sandbox (via the relay) | repo contents (cloned inside the sandbox), CLI invocation strings | smoke/capability tiers build and run the repo's own code in isolation -- see `src/sandbox/`. |

## Domain audit pipeline (`POST /admin/audit-domain`)

| Destination | What's sent | Why |
|---|---|---|
| `cloudflare-dns.com` (DoH) | the target hostname | DNS record lookups -- see `src/audit/dns-probe.ts`, `infra-probe.ts`, `email-probe.ts`. |
| `crt.sh` | the target hostname | certificate transparency log search -- see `src/audit/reputation-probe.ts`. **crt.sh is a public, unauthenticated third party that logs queries.** Auditing a hostname here creates a record, outside Xapi's control, that *someone* queried that hostname's certificates, at that timestamp. |
| `data.iana.org` | nothing hostname-specific (root zone data) | registry/TLD reference data. |
| the target's own `mta-sts.<hostname>` | nothing beyond the request itself | MTA-STS policy fetch -- this contacts the domain being audited directly, not a third party. |

## The actual gap

Nothing today stops `/admin/audit-domain` from being pointed at a
not-yet-public client's domain and creating a crt.sh query for it. That
query is a third party's record, not Xapi's -- it can't be deleted or
un-logged after the fact. There's no code guard for this (crt.sh doesn't
offer one), so the mitigation is process: **don't run `audit-domain`
against a hostname before you're allowed to reveal that you're looking at
it.** Same logic applies more weakly to `cloudflare-dns.com`, which is
lower-risk (a resolver logging routine DNS queries) but still a third
party seeing the hostname.

This is the same class of concern `research.md`'s search-query boundary
was written for elsewhere in this project -- worth keeping the two
consistent if that document changes.
