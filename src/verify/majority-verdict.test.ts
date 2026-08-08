import { describe, expect, it } from "vitest";
import { computeMajorityVerdict } from "./majority-verdict";
import type { FixtureId, FixtureOutcome, FixtureResult } from "../types";

const FIXTURE_IDS: FixtureId[] = [
  "text-native-pdf",
  "scanned-image-pdf",
  "multi-column-pdf",
  "docx",
  "html",
];

function resultsFrom(outcomes: FixtureOutcome[]): FixtureResult[] {
  return outcomes.map((outcome, i) => ({
    fixtureId: FIXTURE_IDS[i]!,
    outcome,
    exitCode: outcome === "usable" ? 0 : 1,
    command: "docparse convert",
    wordCount: outcome === "usable" ? 50 : null,
    detectedStructures: [],
    evidenceKey: `evidence/x/${FIXTURE_IDS[i]}/`,
    durationMs: 1000,
  }));
}

describe("computeMajorityVerdict", () => {
  it("passes at 3/5 usable", () => {
    expect(
      computeMajorityVerdict(resultsFrom(["usable", "usable", "usable", "unusable", "unusable"])),
    ).toBe("capability:pass");
  });

  it("passes at 5/5 usable", () => {
    expect(
      computeMajorityVerdict(resultsFrom(Array(5).fill("usable") as FixtureOutcome[])),
    ).toBe("capability:pass");
  });

  it("is partial at 1/5 usable", () => {
    expect(
      computeMajorityVerdict(
        resultsFrom(["usable", "unusable", "unusable", "unusable", "unusable"]),
      ),
    ).toBe("capability:partial");
  });

  it("is partial at 2/5 usable", () => {
    expect(
      computeMajorityVerdict(
        resultsFrom(["usable", "usable", "unusable", "unusable", "invocation_error"]),
      ),
    ).toBe("capability:partial");
  });

  it("fails at 0/5 usable when the tool actually ran on at least one fixture", () => {
    expect(
      computeMajorityVerdict(
        resultsFrom(["unusable", "unusable", "unusable", "unusable", "unusable"]),
      ),
    ).toBe("capability:fail");
  });

  it("fails when 0/5 usable with a mix of unusable and invocation_error", () => {
    expect(
      computeMajorityVerdict(
        resultsFrom(["unusable", "invocation_error", "unusable", "invocation_error", "unusable"]),
      ),
    ).toBe("capability:fail");
  });

  it("is undetermined when all 5 fixtures errored before reaching the tool's code", () => {
    expect(
      computeMajorityVerdict(resultsFrom(Array(5).fill("invocation_error") as FixtureOutcome[])),
    ).toBe("capability:undetermined");
  });

  it("throws on an empty result set", () => {
    expect(() => computeMajorityVerdict([])).toThrow();
  });
});
