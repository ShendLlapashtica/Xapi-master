import { describe, expect, it } from "vitest";
import { normalizeHandle } from "./x-query";

describe("normalizeHandle", () => {
  it("trims whitespace and strips a leading @", () => {
    expect(normalizeHandle("  @alice ")).toBe("alice");
  });

  it("leaves a handle without @ unchanged", () => {
    expect(normalizeHandle("alice")).toBe("alice");
  });
});
