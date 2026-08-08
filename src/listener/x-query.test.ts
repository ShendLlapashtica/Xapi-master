import { describe, expect, it } from "vitest";
import { buildSearchQuery, normalizeHandle } from "./x-query";

describe("buildSearchQuery", () => {
  it("builds a single OR'd from: clause excluding replies", () => {
    expect(buildSearchQuery(["alice", "bob"])).toBe("(from:alice OR from:bob) -is:reply");
  });

  it("handles a single account", () => {
    expect(buildSearchQuery(["alice"])).toBe("(from:alice) -is:reply");
  });

  it("strips a leading @ from handles", () => {
    expect(buildSearchQuery(["@alice", "bob"])).toBe("(from:alice OR from:bob) -is:reply");
  });

  it("throws on an empty roster", () => {
    expect(() => buildSearchQuery([])).toThrow();
  });
});

describe("normalizeHandle", () => {
  it("trims whitespace and strips a leading @", () => {
    expect(normalizeHandle("  @alice ")).toBe("alice");
  });

  it("leaves a handle without @ unchanged", () => {
    expect(normalizeHandle("alice")).toBe("alice");
  });
});
