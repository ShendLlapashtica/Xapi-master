import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSchema } from "../../test/helpers/apply-schema";
import { insertDiscoveredComponent } from "./components-repo";
import { recordVerdict, traceDecisionChain } from "./decision-log";

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

describe("decision-log", () => {
  it("returns an empty chain for a component with no recorded verdicts", async () => {
    expect(await traceDecisionChain(env.DB, "c1")).toEqual([]);
  });

  it("records a verdict and reads it back", async () => {
    await recordVerdict(env.DB, "c1", "sanity:fail", "no license and no substantive README");
    const chain = await traceDecisionChain(env.DB, "c1");
    expect(chain).toHaveLength(1);
    expect(chain[0]?.status).toBe("sanity:fail");
    expect(chain[0]?.reasoning).toBe("no license and no substantive README");
    expect(chain[0]?.evidence_key).toBeNull();
  });

  it("stores an optional evidence key alongside the verdict", async () => {
    await recordVerdict(env.DB, "c1", "smoke:pass", "build exited 0", "evidence/c1/smoke/result.json");
    const chain = await traceDecisionChain(env.DB, "c1");
    expect(chain[0]?.evidence_key).toBe("evidence/c1/smoke/result.json");
  });

  it("returns multiple verdicts oldest-first, tracing the pipeline's actual sequence", async () => {
    await recordVerdict(env.DB, "c1", "smoke:pass", "build exited 0");
    await recordVerdict(env.DB, "c1", "capability:partial", "2/5 fixtures usable");
    const chain = await traceDecisionChain(env.DB, "c1");
    expect(chain.map((row) => row.status)).toEqual(["smoke:pass", "capability:partial"]);
  });

  it("scopes the chain to the requested component only", async () => {
    await insertDiscoveredComponent(env.DB, {
      id: "c2",
      name: "gadget",
      repoOwner: "acme",
      repoName: "gadget",
      repoUrl: "https://github.com/acme/gadget",
      evidencePrefix: "evidence/c2/",
    });
    await recordVerdict(env.DB, "c1", "smoke:pass", "build exited 0");
    await recordVerdict(env.DB, "c2", "smoke:fail", "build exited 1");

    expect(await traceDecisionChain(env.DB, "c1")).toHaveLength(1);
    expect(await traceDecisionChain(env.DB, "c2")).toHaveLength(1);
  });
});
