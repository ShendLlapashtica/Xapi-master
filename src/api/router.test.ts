import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { router } from "./router";
import type { Env } from "../types";

// router.ts now reaches posts-route.ts -> ../listener/x-client -> rettiwt-api
// on every import, which breaks under this test runner regardless of which
// route a given test actually exercises (a real, documented, pre-existing
// issue -- see README.md's "Known-fragile, honestly" and
// listener-agent.test.ts's identical workaround). Nothing in this file
// touches X directly; the mock exists purely to keep that chain from loading.
vi.mock("../listener/x-client", () => ({
  createXClient: vi.fn(() => ({})),
  postTweet: vi.fn(),
}));

const testEnv = env as unknown as Env;

describe("router", () => {
  it("GET / returns a status view instead of a bare 404", async () => {
    const res = await router(new Request("https://xapi.example/"), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; secretsConfigured: Record<string, boolean> };
    expect(body.name).toBe("xapi");
    expect(body.secretsConfigured).toHaveProperty("X_SESSION_TOKEN");
  });

  it("404s on an undefined route", async () => {
    const res = await router(new Request("https://xapi.example/nope"), testEnv);
    expect(res.status).toBe(404);
  });
});
