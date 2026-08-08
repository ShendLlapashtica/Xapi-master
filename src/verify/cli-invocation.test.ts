import { describe, expect, it } from "vitest";
import { renderCliCommand, renderOutputPath } from "./cli-invocation";

describe("renderCliCommand", () => {
  it("substitutes {input} and {output}", () => {
    expect(renderCliCommand("docparse convert {input} -o {output}", { input: "a.pdf", output: "a.md" })).toBe(
      "docparse convert a.pdf -o a.md",
    );
  });

  it("substitutes repeated occurrences", () => {
    expect(renderCliCommand("cp {input} {input}.bak", { input: "a.pdf", output: "x" })).toBe(
      "cp a.pdf a.pdf.bak",
    );
  });
});

describe("renderOutputPath", () => {
  it("substitutes {basename} with the extension stripped", () => {
    expect(renderOutputPath("{basename}.md", "text-native.pdf")).toBe("text-native.md");
  });

  it("substitutes {input} with the full filename", () => {
    expect(renderOutputPath("out/{input}.out", "sample.docx")).toBe("out/sample.docx.out");
  });

  it("handles a file with no extension", () => {
    expect(renderOutputPath("{basename}.md", "README")).toBe("README.md");
  });
});
