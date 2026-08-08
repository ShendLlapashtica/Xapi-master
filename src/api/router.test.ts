import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { router } from "./router";
import type { Env } from "../types";

const testEnv = env as unknown as Env;

describe("router", () => {
  it("GET / returns a status view instead of a bare 404", async () => {
    const res = await router(new Request("https://xapi.example/"), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; secretsConfigured: Record<string, boolean> };
    expect(body.name).toBe("xapi");
    expect(body.secretsConfigured).toHaveProperty("X_BEARER_TOKEN");
  });

  it("404s on an undefined route", async () => {
    const res = await router(new Request("https://xapi.example/nope"), testEnv);
    expect(res.status).toBe(404);
  });
});
