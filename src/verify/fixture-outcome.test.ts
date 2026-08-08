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
});
