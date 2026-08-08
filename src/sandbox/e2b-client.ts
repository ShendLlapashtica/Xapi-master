import type { Env } from "../types";
import type { RunRequest, RunResponse } from "./e2b-client.types";

const RELAY_INSTANCE_NAME = "relay";

// Talks to relay/ over plain HTTP -- the relay is what actually speaks
// gRPC to E2B. Every call here is one fresh sandbox's worth of work: clone
// at a pinned SHA, run the caller's shell steps, optionally read one
// output file back, and the relay guarantees the sandbox is destroyed
// before responding.
//
// Two ways to reach it, chosen at request time:
//   - env.E2B_RELAY_URL set: a plain HTTPS URL (e.g. a Cloudflare Tunnel to
//     a locally-run relay, see relay/README.md's "run it anywhere" note).
//   - otherwise: the Cloudflare Container binding (src/sandbox/relay-container.ts),
//     the normal production path once relay/Dockerfile is actually deployed.
export async function runInSandbox(request: RunRequest, env: Env): Promise<RunResponse> {
  const res = env.E2B_RELAY_URL
    ? await callRelayUrl(env.E2B_RELAY_URL, request, env)
    : await callRelayContainer(request, env);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`E2B relay /run failed: ${res.status} ${text}`);
  }

  return (await res.json()) as RunResponse;
}

async function callRelayUrl(baseUrl: string, request: RunRequest, env: Env): Promise<Response> {
  return fetch(new URL("/run", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RELAY_SHARED_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

async function callRelayContainer(request: RunRequest, env: Env): Promise<Response> {
  const container = env.E2B_RELAY.getByName(RELAY_INSTANCE_NAME);
  await container.startAndWaitForPorts();

  return container.fetch("http://container/run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RELAY_SHARED_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
}
