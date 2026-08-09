import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { handleAdminAccountsSeed, handleAdminVerifyRepo } from "./admin-route";
import { findComponentByRepo, listAccounts } from "../catalog/components-repo";
import type { Env } from "../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
});

function request(body: unknown, token = testEnv.ADMIN_TOKEN) {
  return new Request("https://xapi.example/admin/accounts/seed", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleAdminAccountsSeed", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminAccountsSeed(request({ accounts: [] }, "wrong"), testEnv);
    expect(res.status).toBe(401);
  });

  it("seeds accounts and normalizes a leading @", async () => {
    const res = await handleAdminAccountsSeed(
      request({ accounts: [{ handle: "@alice", xUserId: "111" }, { handle: "bob", xUserId: "222" }] }),
      testEnv,
    );
    expect(res.status).toBe(200);
    const accounts = await listAccounts(testEnv.DB);
    expect(accounts.map((a) => a.handle).sort()).toEqual(["alice", "bob"]);
  });

  it("seeds an account with no xUserId at all -- optional now that polling goes by username", async () => {
    const res = await handleAdminAccountsSeed(request({ accounts: [{ handle: "carol" }] }), testEnv);
    expect(res.status).toBe(200);
    const accounts = await listAccounts(testEnv.DB);
    expect(accounts.find((a) => a.handle === "carol")?.x_user_id).toBeNull();
  });

  it("400s on an empty accounts array", async () => {
    const res = await handleAdminAccountsSeed(request({ accounts: [] }), testEnv);
    expect(res.status).toBe(400);
  });

  it("400s on malformed JSON", async () => {
    const res = await handleAdminAccountsSeed(
      new Request("https://xapi.example/admin/accounts/seed", {
        method: "POST",
        headers: { authorization: `Bearer ${testEnv.ADMIN_TOKEN}` },
        body: "not json",
      }),
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});

function verifyRepoRequest(body: unknown, token = testEnv.ADMIN_TOKEN) {
  return new Request("https://xapi.example/admin/verify-repo", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleAdminVerifyRepo", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminVerifyRepo(verifyRepoRequest({ repoUrl: "x" }, "wrong"), testEnv);
    expect(res.status).toBe(401);
  });

  it("400s on a non-GitHub URL", async () => {
    const res = await handleAdminVerifyRepo(
      verifyRepoRequest({ repoUrl: "https://example.com/not-a-repo" }),
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it("discovers a new repo and enqueues verification", async () => {
    const res = await handleAdminVerifyRepo(
      verifyRepoRequest({ repoUrl: "https://github.com/acme/widget" }),
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { componentId: string; isNew: boolean };
    expect(body.isNew).toBe(true);

    const component = await findComponentByRepo(testEnv.DB, "acme", "widget");
    expect(component?.id).toBe(body.componentId);
    expect(component?.status).toBe("discovered");
  });

  it("does not re-discover an already-known repo, but still records the source post", async () => {
    await handleAdminVerifyRepo(verifyRepoRequest({ repoUrl: "https://github.com/acme/widget" }), testEnv);
    const res = await handleAdminVerifyRepo(
      verifyRepoRequest({ repoUrl: "https://github.com/acme/widget" }),
      testEnv,
    );
    const body = (await res.json()) as { isNew: boolean };
    expect(body.isNew).toBe(false);
  });
});
