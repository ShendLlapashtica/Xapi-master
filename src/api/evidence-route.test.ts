import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleEvidenceRequest } from "./evidence-route";
import type { Env } from "../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  const listed = await testEnv.EVIDENCE.list();
  await Promise.all(listed.objects.map((o) => testEnv.EVIDENCE.delete(o.key)));
});

describe("handleEvidenceRequest", () => {
  it("streams an object under evidence/", async () => {
    await testEnv.EVIDENCE.put("evidence/c1/smoke/stdout.log", "build ok");
    const res = await handleEvidenceRequest(
      new Request("https://xapi.example/evidence/c1/smoke/stdout.log"),
      testEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("build ok");
  });

  it("404s on a missing key", async () => {
    const res = await handleEvidenceRequest(
      new Request("https://xapi.example/evidence/nope"),
      testEnv,
    );
    expect(res.status).toBe(404);
  });

  it("404s on a path traversal attempt", async () => {
    const res = await handleEvidenceRequest(
      new Request("https://xapi.example/evidence/../fixtures/text-native.pdf"),
      testEnv,
    );
    expect(res.status).toBe(404);
  });
});
