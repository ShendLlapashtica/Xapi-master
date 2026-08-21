import { describe, expect, it } from "vitest";
import { selectScanCandidates } from "./scan-candidates";
import type { GithubTreeEntry } from "../github-client.types";

function blob(path: string, size = 100): GithubTreeEntry {
  return { path, type: "blob", size } as GithubTreeEntry;
}

const options = { extensions: [".ts", ".js"], maxFiles: 30, maxFileSizeBytes: 300_000 };

describe("selectScanCandidates", () => {
  it("includes ordinary source files", () => {
    const result = selectScanCandidates([blob("src/index.ts")], options);
    expect(result.map((e) => e.path)).toEqual(["src/index.ts"]);
  });

  it("excludes __tests__ directories", () => {
    const result = selectScanCandidates([blob("src/__tests__/foo.ts")], options);
    expect(result).toEqual([]);
  });

  it("excludes .test. and .spec. files regardless of directory", () => {
    const result = selectScanCandidates(
      [blob("src/danger-scan.test.ts"), blob("src/danger-scan.spec.js")],
      options,
    );
    expect(result).toEqual([]);
  });

  it("excludes tests/ and fixtures/ directories", () => {
    const result = selectScanCandidates(
      [blob("tests/sample.ts"), blob("test/sample.ts"), blob("fixtures/malicious.js"), blob("fixture/sample.ts")],
      options,
    );
    expect(result).toEqual([]);
  });

  it("does not exclude files that merely contain 'test' as a substring", () => {
    const result = selectScanCandidates([blob("src/latest-changes.ts"), blob("src/attestation.ts")], options);
    expect(result.map((e) => e.path)).toEqual(["src/latest-changes.ts", "src/attestation.ts"]);
  });
});
