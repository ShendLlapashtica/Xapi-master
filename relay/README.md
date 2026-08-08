# xapi-e2b-relay

Why this exists: `BRIEF.md` describes the Verification Workflow talking to
E2B "over plain HTTPS." That's true for E2B's sandbox *lifecycle* API
(create/kill/network rules), but command execution -- clone, install, run
the tool -- goes over gRPC to `envd`, the daemon inside each sandbox.
Cloudflare Workers' `fetch` can't do the bidirectional gRPC streaming that
requires, and the official `e2b` SDK is documented as unsupported on
Workers for the same reason.

So this is one small, trusted Node service sitting between the Workflow and
E2B. It is **not** where untrusted repo code runs -- that's still entirely
inside the E2B microVM, reached via the real `@e2b/sdk`'s gRPC client, which
only a real Node process (not a V8 isolate) can speak. The relay's own code
is fixed and trusted; it just brokers one request shape (`POST /run`: clone
a repo at a pinned SHA, run a list of shell steps, optionally write input
files in and read an output file out) and returns JSON.

## Contract

See [src/types.ts](src/types.ts) for `RunRequest`/`RunResponse`. Mirrored by
hand on the Worker side in `src/sandbox/e2b-client.types.ts` -- there's no
shared package because a Cloudflare Worker can't import Node code and this
service can't run in a V8 isolate.

## Environment variables

| Variable | Purpose |
|---|---|
| `E2B_API_KEY` | E2B account API key. Lives only here -- never sent to the Worker or into a sandbox's own env. |
| `RELAY_SHARED_SECRET` | Bearer token the Worker must present on every `/run` call. Generate a long random value; set the identical value as the Worker's `RELAY_SHARED_SECRET` secret (`wrangler secret put RELAY_SHARED_SECRET`). |
| `PORT` | Optional, defaults to `8080`. |

## Local development

```bash
npm install
E2B_API_KEY=... RELAY_SHARED_SECRET=... npm run dev
```

## Deploying as a Cloudflare Container

This keeps everything except the E2B microVMs themselves on Cloudflare. The
root `wrangler.jsonc` already declares the container binding
(`E2B_RELAY` -> `E2bRelayContainer`, image `./relay/Dockerfile`) and the
Worker-side class in `src/sandbox/relay-container.ts` forwards its
`E2B_API_KEY` / `RELAY_SHARED_SECRET` secrets into the container's env at
start time -- so set those as Worker secrets (`wrangler secret put
E2B_API_KEY`, `wrangler secret put RELAY_SHARED_SECRET`), not as anything
you configure on this directory directly. `wrangler deploy` builds and
pushes this Dockerfile as part of deploying the Worker.

If you'd rather run this relay somewhere other than Cloudflare Containers
(Fly.io, Render, your own box) that also works -- it's a standalone HTTP
service with no Cloudflare-specific code in it. Point
`src/sandbox/e2b-client.ts` at it instead of the container binding and keep
the same bearer-token contract.

## What to verify once you have a real E2B account

- That `network: { allowOut: [...] }` at `Sandbox.create()` actually blocks
  everything not listed (this repo's egress-allowlist tests only check the
  hostname list `egress-policy.ts` computes, not that E2B enforces it).
- That DNS resolution still works for the allowlisted hosts under a
  restrictive `allowOut` (some sandboxed network layers special-case DNS;
  some don't).
- Actual cold-start latency for `Sandbox.create()` per stack template,
  which determines whether the Workflow's 5-minute smoke budget is
  generous or tight in practice.

## Known issue

`npm audit` currently reports a high-severity advisory in `undici`, pulled
in transitively by the `e2b` package itself (not a direct dependency here).
`npm audit fix` can't resolve it without `e2b` bumping its pin. Re-check
`npm audit` when upgrading `e2b`.
