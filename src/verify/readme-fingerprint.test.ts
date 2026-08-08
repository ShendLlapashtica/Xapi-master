import { describe, expect, it } from "vitest";
import { fingerprintReadme } from "./readme-fingerprint";

describe("fingerprintReadme", () => {
  it("produces the same fingerprint for identical text", async () => {
    const a = await fingerprintReadme("# Trading Bot\n\nMakes money fast.");
    const b = await fingerprintReadme("# Trading Bot\n\nMakes money fast.");
    expect(a).toBe(b);
  });

  it("ignores differences in embedded images, links, and numbers", async () => {
    const a = await fingerprintReadme(
      "# Bot\n\n![screenshot](https://example.com/a.png)\n\nEarned $764 on 2026-01-01. [Docs](https://example.com/docs)",
    );
    const b = await fingerprintReadme(
      "# Bot\n\n![proof](https://other.com/b.png)\n\nEarned $312 on 2025-12-05. [Docs](https://other.com/docs2)",
    );
    expect(a).toBe(b);
  });

  it("is case-insensitive and whitespace-insensitive", async () => {
    const a = await fingerprintReadme("Hello   World");
    const b = await fingerprintReadme("hello world");
    expect(a).toBe(b);
  });

  it("produces different fingerprints for genuinely different prose", async () => {
    const a = await fingerprintReadme("A PDF conversion tool that wraps pdfminer.");
    const b = await fingerprintReadme("A crypto trading bot for 5-minute BTC markets.");
    expect(a).not.toBe(b);
  });
});
