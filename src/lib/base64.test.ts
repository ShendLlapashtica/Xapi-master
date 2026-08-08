import { describe, expect, it } from "vitest";
import { base64ToBytes, base64ToText, bytesToBase64 } from "./base64";

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 42]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips text through UTF-8", () => {
    const text = "hello, éè world 😀";
    const encoded = bytesToBase64(new TextEncoder().encode(text));
    expect(base64ToText(encoded)).toBe(text);
  });

  it("handles large inputs without a call-stack overflow", () => {
    const bytes = new Uint8Array(200_000).fill(65);
    const b64 = bytesToBase64(bytes);
    expect(base64ToBytes(b64)).toEqual(bytes);
  });
});
