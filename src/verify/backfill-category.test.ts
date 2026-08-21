import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import {
  getComponent,
  insertDiscoveredComponent,
  updateComponentClassification,
} from "../catalog/components-repo";
import { fingerprintReadme } from "./readme-fingerprint";
import type { Env } from "../types";

const getReadmeTextMock = vi.fn();
vi.mock("./github-client", () => ({
  getReadmeText: (...args: unknown[]) => getReadmeTextMock(...args),
}));

const classifyReadmeMock = vi.fn();
vi.mock("./groq-client", () => ({
  classifyReadme: (...args: unknown[]) => classifyReadmeMock(...args),
}));

const { backfillCategoryForComponent } = await import("./backfill-category");

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
  getReadmeTextMock.mockReset();
  classifyReadmeMock.mockReset();
});

async function seedClassifiedNoNode(id: string, name: string) {
  await insertDiscoveredComponent(testEnv.DB, {
    id,
    name,
    repoOwner: "acme",
    repoName: name,
    repoUrl: `https://github.com/acme/${name}`,
    evidencePrefix: `evidence/${id}/`,
  });
  // Simulate the real legacy state this backfill targets: classify already
  // ran once (category/claims populated) but category_node_id is null --
  // exactly what updateComponentClassification(..., null) would have left
  // before category_node_id existed.
  await updateComponentClassification(
    testEnv.DB,
    id,
    {
      category: "other",
      suggestedCategory: "widget-maker",
      suggestedParentClade: "tools",
      claims: ["makes widgets"],
      mechanismSummary: "makes widgets",
      cliInvocation: { command: "widget", outputMode: "stdout", outputPathTemplate: null },
      rawResponseEvidenceKey: "evidence/old/response.json",
    },
    null,
  );
}

describe("backfillCategoryForComponent", () => {
  it("skips a component that already has category_node_id", async () => {
    await insertDiscoveredComponent(testEnv.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });
    const nodeId = crypto.randomUUID();
    await testEnv.DB.prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, 'widget-maker', NULL)")
      .bind(nodeId)
      .run();
    await updateComponentClassification(
      testEnv.DB,
      "c1",
      {
        category: "other",
        suggestedCategory: "widget-maker",
        suggestedParentClade: "tools",
        claims: ["makes widgets"],
        mechanismSummary: "makes widgets",
        cliInvocation: { command: "widget", outputMode: "stdout", outputPathTemplate: null },
        rawResponseEvidenceKey: "evidence/old/response.json",
      },
      nodeId,
    );

    const result = await backfillCategoryForComponent(testEnv, "c1");
    expect(result).toEqual({ componentId: "c1", name: "widget", result: "skipped_has_category_node_id" });
    expect(getReadmeTextMock).not.toHaveBeenCalled();
  });

  it("skips a component that never reached classify", async () => {
    await insertDiscoveredComponent(testEnv.DB, {
      id: "c2",
      name: "raw",
      repoOwner: "acme",
      repoName: "raw",
      repoUrl: "https://github.com/acme/raw",
      evidencePrefix: "evidence/c2/",
    });

    const result = await backfillCategoryForComponent(testEnv, "c2");
    expect(result).toEqual({ componentId: "c2", name: "raw", result: "skipped_never_classified" });
    expect(getReadmeTextMock).not.toHaveBeenCalled();
  });

  it("reuses an existing duplicate's category_node_id without calling Groq", async () => {
    // The "duplicate" -- already fully classified, including a real node id.
    await seedClassifiedNoNode("dup", "template-a");
    const parentId = crypto.randomUUID();
    await testEnv.DB.prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, 'tools', NULL)")
      .bind(parentId)
      .run();
    const nodeId = crypto.randomUUID();
    await testEnv.DB.prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, 'widget-maker', ?)")
      .bind(nodeId, parentId)
      .run();
    const sharedReadme = "same shared readme text";
    const sharedFingerprint = await fingerprintReadme(sharedReadme);
    await testEnv.DB.prepare("UPDATE components SET category_node_id = ?, readme_fingerprint = ? WHERE id = 'dup'")
      .bind(nodeId, sharedFingerprint)
      .run();

    // The orphaned row under test -- shares the same README, hence same fingerprint.
    await seedClassifiedNoNode("c3", "template-b");
    getReadmeTextMock.mockResolvedValue(sharedReadme);

    const result = await backfillCategoryForComponent(testEnv, "c3");

    expect(result.result).toBe("duplicate");
    if (result.result === "duplicate") {
      expect(result.categoryNodeId).toBe(nodeId);
      expect(result.duplicateOf).toBe("dup");
    }
    expect(classifyReadmeMock).not.toHaveBeenCalled();

    const updated = await getComponent(testEnv.DB, "c3");
    expect(updated?.category_node_id).toBe(nodeId);
  });

  it("classifies fresh and creates a category node when there's no duplicate", async () => {
    await seedClassifiedNoNode("c4", "unique-tool");
    getReadmeTextMock.mockResolvedValue("a genuinely unique readme");
    classifyReadmeMock.mockResolvedValue({
      classification: {
        category: "other",
        suggestedCategory: "unique-leaf",
        suggestedParentClade: "tools",
        claims: ["does a unique thing"],
        mechanismSummary: "does a unique thing",
        cliInvocation: { command: "unique-tool", outputMode: "stdout", outputPathTemplate: null },
        rawResponseEvidenceKey: "",
      },
      rawResponseText: "{}",
    });

    const result = await backfillCategoryForComponent(testEnv, "c4");

    expect(result.result).toBe("classified");
    const updated = await getComponent(testEnv.DB, "c4");
    expect(updated?.category_node_id).toBeTruthy();

    const node = await testEnv.DB.prepare("SELECT name, parent_id FROM categories WHERE id = ?")
      .bind(updated?.category_node_id)
      .first<{ name: string; parent_id: string | null }>();
    expect(node?.name).toBe("unique-leaf");
    expect(node?.parent_id).toBeTruthy();
  });

  it("returns skipped_no_readme when the repo has no README", async () => {
    await seedClassifiedNoNode("c5", "no-readme-tool");
    getReadmeTextMock.mockResolvedValue(null);

    const result = await backfillCategoryForComponent(testEnv, "c5");
    expect(result).toEqual({ componentId: "c5", name: "no-readme-tool", result: "skipped_no_readme" });
    expect(classifyReadmeMock).not.toHaveBeenCalled();
  });

  it("returns an error outcome instead of throwing when classify fails, after exhausting backoff", async () => {
    await seedClassifiedNoNode("c6", "flaky-tool");
    getReadmeTextMock.mockResolvedValue("some readme");
    classifyReadmeMock.mockRejectedValue(new Error("groq exploded"));

    vi.useFakeTimers();
    try {
      const pending = backfillCategoryForComponent(testEnv, "c6");
      // 5 backoff delays (15s/30s/60s/120s/240s) between the 6 attempts --
      // fast-forward past all of them rather than actually waiting minutes.
      await vi.advanceTimersByTimeAsync(15_000 + 30_000 + 60_000 + 120_000 + 240_000);
      const result = await pending;
      expect(result.result).toBe("error");
      if (result.result === "error") {
        expect(result.error).toContain("groq exploded");
      }
      expect(classifyReadmeMock).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
