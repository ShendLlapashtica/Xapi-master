import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredComponent, insertSourcePost, updateComponentClassification, updateComponentStatus } from "../catalog/components-repo";
import { evidenceKey } from "../catalog/evidence-store";
import { handleComponentsRequest } from "./components-route";
import type { ComponentsResponse, Env } from "../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
  const listed = await testEnv.EVIDENCE.list();
  await Promise.all(listed.objects.map((o) => testEnv.EVIDENCE.delete(o.key)));
});

async function seedComponent(id: string, overrides: { category?: string; status?: string } = {}) {
  await insertDiscoveredComponent(testEnv.DB, {
    id,
    name: id,
    repoOwner: "acme",
    repoName: id,
    repoUrl: `https://github.com/acme/${id}`,
    evidencePrefix: `evidence/${id}/`,
  });
  await insertSourcePost(testEnv.DB, id, {
    postId: `p-${id}`,
    postUrl: `https://x.com/alice/status/p-${id}`,
    authorHandle: "alice",
    postedAt: "2026-01-01T00:00:00Z",
  });
  if (overrides.category) {
    await updateComponentClassification(testEnv.DB, id, {
      category: overrides.category as never,
      claims: ["does a thing"],
      mechanismSummary: "wraps a library",
      cliInvocation: { command: "x {input}", outputMode: "stdout", outputPathTemplate: null },
      rawResponseEvidenceKey: evidenceKey(id, "classify", "response.json"),
    });
  }
  if (overrides.status) {
    await updateComponentStatus(testEnv.DB, id, overrides.status as never, true);
  }
  await testEnv.EVIDENCE.put(evidenceKey(id, "sanity", "result.json"), "{}");
}

describe("handleComponentsRequest", () => {
  it("returns all components with evidence links and source posts", async () => {
    await seedComponent("c1", { category: "document-parsing-conversion", status: "smoke:pass" });

    const res = await handleComponentsRequest(new Request("https://xapi.example/components"), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ComponentsResponse;
    expect(body.components).toHaveLength(1);
    expect(body.components[0]?.status).toBe("smoke:pass");
    expect(body.components[0]?.evidence.links).toEqual(["/evidence/c1/sanity/result.json"]);
    expect(body.components[0]?.sourcePosts).toHaveLength(1);
  });

  it("filters by category", async () => {
    await seedComponent("c1", { category: "document-parsing-conversion" });
    await seedComponent("c2", { category: "ocr" });

    const res = await handleComponentsRequest(
      new Request("https://xapi.example/components?category=ocr"),
      testEnv,
    );
    const body = (await res.json()) as ComponentsResponse;
    expect(body.components.map((c) => c.id)).toEqual(["c2"]);
  });

  it("filters by status", async () => {
    await seedComponent("c1", { status: "sanity:fail" });
    await seedComponent("c2", { status: "smoke:pass" });

    const res = await handleComponentsRequest(
      new Request("https://xapi.example/components?status=sanity:fail"),
      testEnv,
    );
    const body = (await res.json()) as ComponentsResponse;
    expect(body.components.map((c) => c.id)).toEqual(["c1"]);
  });

  it("400s on an unknown category", async () => {
    const res = await handleComponentsRequest(
      new Request("https://xapi.example/components?category=nonsense"),
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it("400s on an unknown status", async () => {
    const res = await handleComponentsRequest(
      new Request("https://xapi.example/components?status=nonsense"),
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});
