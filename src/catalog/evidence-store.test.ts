import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { evidenceKey, evidencePrefix, listEvidenceKeys, writeEvidenceBatch } from "./evidence-store";

beforeEach(async () => {
  const listed = await env.EVIDENCE.list();
  await Promise.all(listed.objects.map((o) => env.EVIDENCE.delete(o.key)));
});

describe("evidence-store", () => {
  it("builds keys under a component's prefix", () => {
    expect(evidencePrefix("c1")).toBe("evidence/c1/");
    expect(evidenceKey("c1", "smoke", "stdout.log")).toBe("evidence/c1/smoke/stdout.log");
  });

  it("writes a batch and lists keys back under the prefix", async () => {
    await writeEvidenceBatch(env.EVIDENCE, [
      { key: evidenceKey("c1", "sanity", "result.json"), body: "{}", contentType: "application/json" },
      { key: evidenceKey("c1", "smoke", "stdout.log"), body: "ok" },
      { key: evidenceKey("c2", "sanity", "result.json"), body: "{}" },
    ]);

    const keys = await listEvidenceKeys(env.EVIDENCE, evidencePrefix("c1"));
    expect(keys.sort()).toEqual(
      ["evidence/c1/sanity/result.json", "evidence/c1/smoke/stdout.log"].sort(),
    );
  });
});
