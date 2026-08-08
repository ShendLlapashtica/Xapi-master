import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixtureIds, runCapabilityFixture } from "./capability";
import type { Env } from "../../types";

const testEnv = env as unknown as Env;

beforeEach(async () => {
  const listed = await testEnv.EVIDENCE.list();
  await Promise.all(listed.objects.map((o) => testEnv.EVIDENCE.delete(o.key)));
});

describe("FIXTURES manifest", () => {
  it("has exactly the five fixtures the brief specifies", () => {
    expect(fixtureIds().sort()).toEqual(
      ["docx", "html", "multi-column-pdf", "scanned-image-pdf", "text-native-pdf"].sort(),
    );
  });

  it("every fixture has a minWordCount and a file name", () => {
    for (const fixture of FIXTURES) {
      expect(fixture.file.length).toBeGreaterThan(0);
      expect(fixture.minWordCount).toBeGreaterThan(0);
    }
  });
});

describe("runCapabilityFixture", () => {
  it("returns invocation_error without calling the sandbox when the fixture asset is missing from R2", async () => {
    const fixture = FIXTURES[0]!;
    const result = await runCapabilityFixture(
      fixture,
      {
        owner: "acme",
        repo: "widget",
        commitSha: "abc123",
        stack: "node",
        packageDir: null,
        cliInvocation: { command: "docparse {input}", outputMode: "stdout", outputPathTemplate: null },
      },
      testEnv,
    );
    expect(result.outcome).toBe("invocation_error");
    expect(result.stderr).toMatch(/missing from R2/);
  });
});
