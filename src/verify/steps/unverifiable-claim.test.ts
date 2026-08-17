import { describe, expect, it } from "vitest";
import { detectUnverifiableClaim } from "./unverifiable-claim";

describe("detectUnverifiableClaim", () => {
  it("flags a claim naming a specific external target", () => {
    const result = detectUnverifiableClaim(["scrapes encar.com listings"], "Reverse-engineers encar.com's internal API.");
    expect(result.unverifiable).toBe(true);
    expect(result.matchedClaim).toMatch(/encar\.com/);
  });

  it("does not flag a generic, configurable-target claim", () => {
    const result = detectUnverifiableClaim(
      ["scrapes any website you configure"],
      "Generic HTML scraper with a pluggable selector config.",
    );
    expect(result.unverifiable).toBe(false);
  });

  it("does not flag a tool with no scraping-shaped claims at all", () => {
    const result = detectUnverifiableClaim(["converts PDF to Markdown"], "Parses PDF structure and re-emits Markdown.");
    expect(result.unverifiable).toBe(false);
  });

  it("checks mechanismSummary as well as claims", () => {
    const result = detectUnverifiableClaim([], "Bypasses shend.dev's rate limiting via rotating residential proxies.");
    expect(result.unverifiable).toBe(true);
    expect(result.reason).toMatch(/live external target/);
  });
});
