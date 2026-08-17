import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredComponent, insertSourcePost, updateComponentStatus } from "../catalog/components-repo";
import { listPosts } from "../catalog/posts-repo";
import { draftStartedPost, draftWorkflowResult } from "./verify-workflow";
import type { WorkflowStep } from "cloudflare:workers";

// Minimal fake -- every call site in verify-workflow.ts uses the
// two-argument step.do(name, callback) form, never the config-object
// overload, so this only needs to cover that shape.
const fakeStep = {
  do: async (_name: string, fn: () => Promise<unknown>) => fn(),
} as unknown as WorkflowStep;

beforeEach(async () => {
  await resetSchema(env.DB);
  await insertDiscoveredComponent(env.DB, {
    id: "c1",
    name: "widget",
    repoOwner: "acme",
    repoName: "widget",
    repoUrl: "https://github.com/acme/widget",
    evidencePrefix: "evidence/c1/",
  });
});

describe("draftStartedPost", () => {
  it("drafts a pending post replying to the discovering tweet", async () => {
    await insertSourcePost(env.DB, "c1", {
      postId: "999",
      postUrl: "https://x.com/alice/status/999",
      authorHandle: "alice",
      postedAt: "2026-08-01T00:00:00.000Z",
    });

    await draftStartedPost(fakeStep, env.DB, "c1", "acme", "widget");

    const { rows } = await listPosts(env.DB, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reply_to_tweet_id).toBe("999");
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.text).toContain("acme/widget");
  });

  it("drafts nothing for a manually-triggered component", async () => {
    await insertSourcePost(env.DB, "c1", {
      postId: "manual-abc",
      postUrl: "manual-trigger",
      authorHandle: "admin",
      postedAt: "2026-08-01T00:00:00.000Z",
    });

    await draftStartedPost(fakeStep, env.DB, "c1", "acme", "widget");

    const { rows } = await listPosts(env.DB, {});
    expect(rows).toHaveLength(0);
  });
});

describe("draftWorkflowResult", () => {
  it("drafts nothing until the component reaches a terminal status", async () => {
    await insertSourcePost(env.DB, "c1", {
      postId: "999",
      postUrl: "https://x.com/alice/status/999",
      authorHandle: "alice",
      postedAt: "2026-08-01T00:00:00.000Z",
    });

    await draftWorkflowResult(fakeStep, env.DB, "c1");

    const { rows } = await listPosts(env.DB, {});
    expect(rows).toHaveLength(0);
  });

  it("drafts the result reply once the component is terminal", async () => {
    await insertSourcePost(env.DB, "c1", {
      postId: "999",
      postUrl: "https://x.com/alice/status/999",
      authorHandle: "alice",
      postedAt: "2026-08-01T00:00:00.000Z",
    });
    await updateComponentStatus(env.DB, "c1", "smoke:pass", true);

    await draftWorkflowResult(fakeStep, env.DB, "c1");

    const { rows } = await listPosts(env.DB, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reply_to_tweet_id).toBe("999");
    expect(rows[0]?.text).toContain("acme/widget");
  });

  it("drafts nothing for a manually-triggered component even once terminal", async () => {
    await insertSourcePost(env.DB, "c1", {
      postId: "manual-abc",
      postUrl: "manual-trigger",
      authorHandle: "admin",
      postedAt: "2026-08-01T00:00:00.000Z",
    });
    await updateComponentStatus(env.DB, "c1", "smoke:pass", true);

    await draftWorkflowResult(fakeStep, env.DB, "c1");

    const { rows } = await listPosts(env.DB, {});
    expect(rows).toHaveLength(0);
  });
});
