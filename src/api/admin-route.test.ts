import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { handleAdminAccountsSeed, handleAdminAuditDomain, handleAdminVerifyRepo } from "./admin-route";
import { findComponentByRepo, listAccounts } from "../catalog/components-repo";
import { findDomainByHostname } from "../catalog/domains-repo";
import type { Env } from "../types";

const testEnv = env as unknown as Env;
const originalDomainAuditWorkflow = testEnv.DOMAIN_AUDIT_WORKFLOW;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
  // handleAdminAuditDomain triggers a real DomainAuditWorkflow run, which
  // would hit real DNS/TLS/etc probes against whatever hostname the test
  // uses -- these tests are about the route's own logic (auth, discover vs.
  // re-audit, the watched flag), not the workflow's probes, so the trigger
  // is stubbed the same way domain-audit-agent.test.ts stubs it.
  testEnv.DOMAIN_AUDIT_WORKFLOW = { create: vi.fn() } as never;
});

afterEach(() => {
  testEnv.DOMAIN_AUDIT_WORKFLOW = originalDomainAuditWorkflow;
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

function auditDomainRequest(body: unknown, token = testEnv.ADMIN_TOKEN) {
  return new Request("https://xapi.example/admin/audit-domain", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleAdminAuditDomain", () => {
  it("rejects a missing/incorrect bearer token", async () => {
    const res = await handleAdminAuditDomain(auditDomainRequest({ hostname: "example.com" }, "wrong"), testEnv);
    expect(res.status).toBe(401);
  });

  it("400s on an invalid hostname", async () => {
    const res = await handleAdminAuditDomain(auditDomainRequest({ hostname: "not a hostname" }), testEnv);
    expect(res.status).toBe(400);
  });

  it("discovers a new domain, is not watched by default, and triggers an audit", async () => {
    const res = await handleAdminAuditDomain(auditDomainRequest({ hostname: "https://autokoreablendi.com/" }), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isNew: boolean; hostname: string };
    expect(body.isNew).toBe(true);
    expect(body.hostname).toBe("autokoreablendi.com");

    const domain = await findDomainByHostname(testEnv.DB, "autokoreablendi.com");
    expect(domain?.watched).toBe(0);
    expect(testEnv.DOMAIN_AUDIT_WORKFLOW.create).toHaveBeenCalledTimes(1);
  });

  it("marks a domain watched when watched:true is passed", async () => {
    await handleAdminAuditDomain(auditDomainRequest({ hostname: "autokoreablendi.com", watched: true }), testEnv);
    const domain = await findDomainByHostname(testEnv.DB, "autokoreablendi.com");
    expect(domain?.watched).toBe(1);
    expect(domain?.watched_at).not.toBeNull();
  });

  it("re-audits an already-known domain without inserting a duplicate row", async () => {
    await handleAdminAuditDomain(auditDomainRequest({ hostname: "autokoreablendi.com" }), testEnv);
    const res = await handleAdminAuditDomain(auditDomainRequest({ hostname: "autokoreablendi.com" }), testEnv);
    const body = (await res.json()) as { isNew: boolean };
    expect(body.isNew).toBe(false);
    expect(testEnv.DOMAIN_AUDIT_WORKFLOW.create).toHaveBeenCalledTimes(2);
  });
});
