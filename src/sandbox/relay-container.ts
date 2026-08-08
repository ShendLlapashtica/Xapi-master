import { Container } from "@cloudflare/containers";
import type { Env } from "../types";

// Wraps relay/ (see relay/README.md for why it exists) as a Cloudflare
// Container so the only thing off Cloudflare is the E2B microVMs
// themselves -- the relay that brokers gRPC command execution to them
// still runs on Cloudflare infrastructure, just outside the V8 isolate
// that can't speak gRPC.
export class E2bRelayContainer extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "/health";
  enableInternet = true; // must reach api.e2b.app and each sandbox's envd
  sleepAfter = "10m";

  // Matches Container<Env>'s own constructor signature exactly (via
  // ConstructorParameters) rather than re-declaring `ctx`'s type by hand.
  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args);
    const [, env] = args;
    // E2B_API_KEY and RELAY_SHARED_SECRET live only in the Worker's secrets
    // (never in this repo's config) and are forwarded into the container's
    // process env here -- this is the one hop where they're allowed to
    // exist outside the Worker, since the relay is trusted infra, not
    // where the untrusted repo's code runs.
    this.envVars = {
      E2B_API_KEY: env.E2B_API_KEY,
      RELAY_SHARED_SECRET: env.RELAY_SHARED_SECRET,
    };
  }

  override onError(error: unknown): void {
    console.error("E2bRelayContainer error", error);
  }
}
