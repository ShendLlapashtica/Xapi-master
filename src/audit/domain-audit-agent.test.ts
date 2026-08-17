import { getAgentByName } from "agents";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredDomain, setDomainWatched, updateDomainAuditStatus } from "../catalog/domains-repo";
import type { Env } from "../types";

// Resolving *any* Durable Object binding (getAgentByName) loads the whole
// worker module graph, since every DO class is exported from src/index.ts
// for wrangler's binding to find it -- that pulls in ListenerAgent, whose
// x-client import chain (rettiwt-api -> rettiwt-auth -> https-proxy-agent)
// breaks under vitest-pool-workers' ESM loader (a real, documented,
// pre-existing issue, see README.md's "Known-fragile, honestly" and
// listener-agent.test.ts's identical workaround). This agent has nothing to
// do with X -- the mock exists purely to keep that unrelated chain from
// loading, not because domain-audit-agent.ts imports x-client itself.
vi.mock("../listener/x-client", () => ({
  createXClient: vi.fn(() => ({})),
  pollAccounts: vi.fn(),
}));

const testEnv = env as unknown as Env;

beforeEach(async () => {
  await resetSchema(testEnv.DB);
});

describe("DomainAuditAgent.tick", () => {
  it("does nothing when no domain is watched", async () => {
    const createMock = vi.fn();
    testEnv.DOMAIN_AUDIT_WORKFLOW = { create: createMock } as never;

    const agent = await getAgentByName(testEnv.DOMAIN_AUDIT_AGENT, "no-watch-test");
    await agent.tick();

    expect(createMock).not.toHaveBeenCalled();
  });

  it("triggers the audit workflow once per watched domain", async () => {
    await insertDiscoveredDomain(testEnv.DB, "d1", "autokoreablendi.com");
    await insertDiscoveredDomain(testEnv.DB, "d2", "example.com");
    await insertDiscoveredDomain(testEnv.DB, "d3", "unwatched.com");
    await setDomainWatched(testEnv.DB, "d1", true);
    await setDomainWatched(testEnv.DB, "d2", true);

    const createMock = vi.fn();
    testEnv.DOMAIN_AUDIT_WORKFLOW = { create: createMock } as never;

    const agent = await getAgentByName(testEnv.DOMAIN_AUDIT_AGENT, "trigger-test");
    await agent.tick();

    expect(createMock).toHaveBeenCalledTimes(2);
    const hostnames = createMock.mock.calls.map((call) => (call[0] as { params: { hostname: string } }).params.hostname);
    expect(hostnames.sort()).toEqual(["autokoreablendi.com", "example.com"]);

    const state = await agent.state;
    expect(state.lastTickAt).not.toBeNull();
  });

  it("skips a watched domain that is already mid-audit", async () => {
    await insertDiscoveredDomain(testEnv.DB, "d1", "autokoreablendi.com");
    await setDomainWatched(testEnv.DB, "d1", true);
    await updateDomainAuditStatus(testEnv.DB, "d1", "auditing");

    const createMock = vi.fn();
    testEnv.DOMAIN_AUDIT_WORKFLOW = { create: createMock } as never;

    const agent = await getAgentByName(testEnv.DOMAIN_AUDIT_AGENT, "skip-auditing-test");
    await agent.tick();

    expect(createMock).not.toHaveBeenCalled();
  });
});
