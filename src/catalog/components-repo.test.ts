import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import {
  findComponentByRepo,
  findOrCreateCategoryNode,
  getCategoryNode,
  getComponent,
  insertDiscoveredComponent,
  insertSourcePost,
  listComponents,
  listSourcePostsForComponent,
  updateComponentClassification,
  updateComponentStatus,
  upsertAccount,
  listAccounts,
} from "./components-repo";
import type { Classification } from "../types";

beforeEach(async () => {
  await resetSchema(env.DB);
});

describe("components-repo", () => {
  it("inserts a discovered component and finds it by repo", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });

    const found = await findComponentByRepo(env.DB, "acme", "widget");
    expect(found?.id).toBe("c1");
    expect(found?.status).toBe("discovered");
    expect(found?.tier_reached).toBe("none");

    expect(await findComponentByRepo(env.DB, "acme", "nope")).toBeNull();
  });

  it("enforces uniqueness on (repo_owner, repo_name)", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });
    await expect(
      insertDiscoveredComponent(env.DB, {
        id: "c2",
        name: "widget",
        repoOwner: "acme",
        repoName: "widget",
        repoUrl: "https://github.com/acme/widget",
        evidencePrefix: "evidence/c2/",
      }),
    ).rejects.toThrow();
  });

  it("inserts source posts idempotently on (component_id, post_id)", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });
    const post = { postId: "p1", postUrl: "https://x.com/a/status/p1", authorHandle: "a", postedAt: "2026-01-01" };
    await insertSourcePost(env.DB, "c1", post);
    await insertSourcePost(env.DB, "c1", post); // retried message, should not duplicate

    const posts = await listSourcePostsForComponent(env.DB, "c1");
    expect(posts).toHaveLength(1);
  });

  it("updates classification fields", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });
    const classification: Classification = {
      category: "document-parsing-conversion",
      suggestedCategory: "pdf-conversion",
      claims: ["converts PDFs to markdown"],
      mechanismSummary: "wraps pdfminer",
      cliInvocation: { command: "docparse {input}", outputMode: "stdout", outputPathTemplate: null },
      rawResponseEvidenceKey: "evidence/c1/classify/response.json",
    };
    const categoryNodeId = await findOrCreateCategoryNode(env.DB, classification.suggestedCategory);
    await updateComponentClassification(env.DB, "c1", classification, categoryNodeId);

    const row = await getComponent(env.DB, "c1");
    expect(row?.category).toBe("document-parsing-conversion");
    expect(row?.category_node_id).toBe(categoryNodeId);
    expect(JSON.parse(row?.claims ?? "[]")).toEqual(["converts PDFs to markdown"]);
  });

  it("finds or creates category nodes, deduping by (name, parent)", async () => {
    const first = await findOrCreateCategoryNode(env.DB, "crypto-trading-bot");
    const second = await findOrCreateCategoryNode(env.DB, "crypto-trading-bot");
    expect(second).toBe(first);

    const node = await getCategoryNode(env.DB, first);
    expect(node?.name).toBe("crypto-trading-bot");
    expect(node?.parent_id).toBeNull();

    const child = await findOrCreateCategoryNode(env.DB, "arbitrage", first);
    expect(child).not.toBe(first);
    const childNode = await getCategoryNode(env.DB, child);
    expect(childNode?.parent_id).toBe(first);

    // Same name, different parent -- a distinct node, not a dedupe match.
    const sameNameDifferentParent = await findOrCreateCategoryNode(env.DB, "arbitrage");
    expect(sameNameDifferentParent).not.toBe(child);
  });

  it("updates status/tier and stamps verified_at only when terminal", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "widget",
      repoOwner: "acme",
      repoName: "widget",
      repoUrl: "https://github.com/acme/widget",
      evidencePrefix: "evidence/c1/",
    });

    await updateComponentStatus(env.DB, "c1", "sanity:fail", true);
    const row = await getComponent(env.DB, "c1");
    expect(row?.status).toBe("sanity:fail");
    expect(row?.tier_reached).toBe("none");
    expect(row?.verified_at).not.toBeNull();
  });

  it("lists components filtered by category and status", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c1",
      name: "a",
      repoOwner: "acme",
      repoName: "a",
      repoUrl: "https://github.com/acme/a",
      evidencePrefix: "evidence/c1/",
    });
    await insertDiscoveredComponent(env.DB, {
      id: "c2",
      name: "b",
      repoOwner: "acme",
      repoName: "b",
      repoUrl: "https://github.com/acme/b",
      evidencePrefix: "evidence/c2/",
    });
    await updateComponentClassification(env.DB, "c2", {
      category: "ocr",
      suggestedCategory: "ocr",
      claims: [],
      mechanismSummary: "",
      cliInvocation: { command: "x", outputMode: "stdout", outputPathTemplate: null },
      rawResponseEvidenceKey: "k",
    });
    await updateComponentStatus(env.DB, "c2", "smoke:pass", true);

    const { rows } = await listComponents(env.DB, { status: "smoke:pass" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("c2");

    const { rows: byCategory } = await listComponents(env.DB, { category: "ocr" });
    expect(byCategory).toHaveLength(1);
  });

  it("paginates with a cursor", async () => {
    for (let i = 0; i < 3; i++) {
      await insertDiscoveredComponent(env.DB, {
        id: `c${i}`,
        name: `n${i}`,
        repoOwner: "acme",
        repoName: `r${i}`,
        repoUrl: `https://github.com/acme/r${i}`,
        evidencePrefix: `evidence/c${i}/`,
      });
    }
    const page1 = await listComponents(env.DB, { limit: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listComponents(env.DB, { limit: 2, cursor: page1.nextCursor ?? undefined });
    expect(page2.rows).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it("upserts accounts by handle", async () => {
    await upsertAccount(env.DB, "alice", "111");
    await upsertAccount(env.DB, "alice", "222"); // re-seed with corrected id
    const accounts = await listAccounts(env.DB);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.x_user_id).toBe("222");
  });
});
