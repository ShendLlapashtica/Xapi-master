import { describe, expect, it } from "vitest";
import { classifyFixtureOutcome } from "./fixture-outcome";
import type { FixtureExpectedProfile } from "../types";

const baseExpected: FixtureExpectedProfile = {
  fixtureId: "text-native-pdf",
  file: "text-native.pdf",
  minWordCount: 20,
  expectedStructures: [],
};

describe("classifyFixtureOutcome", () => {
  it("marks a clean run with sufficient output as usable", () => {
    const outputText = Array(30).fill("word").join(" ");
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      baseExpected,
    );
    expect(result.outcome).toBe("usable");
    expect(result.wordCount).toBe(30);
  });

  it("marks exit code 127 as invocation_error regardless of output", () => {
    const result = classifyFixtureOutcome(
      { exitCode: 127, stderr: "", outputText: null },
      baseExpected,
    );
    expect(result.outcome).toBe("invocation_error");
  });

  it("marks a usage-string stderr as invocation_error even on exit code 1", () => {
    const result = classifyFixtureOutcome(
      { exitCode: 1, stderr: "usage: docparse <input> [options]", outputText: null },
      baseExpected,
    );
    expect(result.outcome).toBe("invocation_error");
  });

  it("marks a nonzero exit with no usage-error signature as unusable, not invocation_error", () => {
    const result = classifyFixtureOutcome(
      { exitCode: 1, stderr: "Segmentation fault", outputText: null },
      baseExpected,
    );
    expect(result.outcome).toBe("unusable");
  });

  it("marks a clean exit with output below the word-count bar as unusable", () => {
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText: "too short" },
      baseExpected,
    );
    expect(result.outcome).toBe("unusable");
  });

  it("marks a clean exit with empty output as unusable", () => {
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText: "" },
      baseExpected,
    );
    expect(result.outcome).toBe("unusable");
  });

  it("requires at least one expected structure when the profile specifies any", () => {
    const withTableExpectation: FixtureExpectedProfile = {
      ...baseExpected,
      expectedStructures: ["table"],
    };
    const enoughWordsNoTable = Array(30).fill("word").join(" ");
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText: enoughWordsNoTable },
      withTableExpectation,
    );
    expect(result.outcome).toBe("unusable");
  });

  it("detects a markdown table and heading", () => {
    const outputText = [
      "# Title",
      Array(25).fill("word").join(" "),
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const withTableExpectation: FixtureExpectedProfile = {
      ...baseExpected,
      expectedStructures: ["table", "heading"],
    };
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      withTableExpectation,
    );
    expect(result.outcome).toBe("usable");
    expect(result.detectedStructures).toEqual(expect.arrayContaining(["table", "heading"]));
  });

  it("detects an HTML table and heading", () => {
    const outputText = `<h2>Report</h2><p>${Array(25).fill("word").join(" ")}</p><table><tr><td>1</td></tr></table>`;
    const withTableExpectation: FixtureExpectedProfile = {
      ...baseExpected,
      expectedStructures: ["table"],
    };
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      withTableExpectation,
    );
    expect(result.detectedStructures).toContain("table");
    expect(result.detectedStructures).toContain("heading");
    expect(result.outcome).toBe("usable");
  });

  // Regression test for the real firecrawl/anydoc finding
  // (diligence/2026-08-10-anydoc-manual-capability-test.md): word count and
  // structure detection alone scored this exact garbled output as usable,
  // because the interleaved text still contains every real word from the
  // fixture. expectedOrderedAnchors is what closes that gap.
  const multiColumnExpected: FixtureExpectedProfile = {
    fixtureId: "multi-column-pdf",
    file: "multi-column.pdf",
    minWordCount: 10,
    expectedStructures: [],
    expectedOrderedAnchors: [
      "left column, first sentence",
      "left column, second sentence",
      "right column, first sentence",
      "right column, second sentence",
    ],
  };

  it("marks correctly column-ordered output as usable", () => {
    const outputText = [
      "left column, first sentence.",
      "left column, second sentence.",
      "right column, first sentence.",
      "right column, second sentence.",
    ].join(" ");
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      multiColumnExpected,
    );
    expect(result.outcome).toBe("usable");
  });

  it("marks row-interleaved column output as unusable even with enough words and no structure requirement", () => {
    // Same four fragments as above, same total word count -- just row-by-row
    // interleaved (left1, right1, left2, right2) instead of column-by-column,
    // matching the real naive-extractor failure mode.
    const outputText = [
      "left column, first sentence.",
      "right column, first sentence.",
      "left column, second sentence.",
      "right column, second sentence.",
    ].join(" ");
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      multiColumnExpected,
    );
    expect(result.outcome).toBe("unusable");
    expect(result.wordCount).toBeGreaterThanOrEqual(multiColumnExpected.minWordCount);
  });

  it("is unaffected by expectedOrderedAnchors when the profile doesn't set any", () => {
    const outputText = Array(30).fill("word").join(" ");
    const result = classifyFixtureOutcome(
      { exitCode: 0, stderr: "", outputText },
      baseExpected,
    );
    expect(result.outcome).toBe("usable");
  });
});
