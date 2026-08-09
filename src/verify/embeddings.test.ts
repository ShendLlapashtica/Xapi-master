import { describe, expect, it } from "vitest";
import { embedText, filterRelevantMatches } from "./embeddings";

function fakeAi(vector: number[]): Ai {
  return {
    run: async () => ({ data: [vector] }),
  } as unknown as Ai;
}

describe("embedText", () => {
  it("returns the embedding vector from the AI binding", async () => {
    const vector = await embedText(fakeAi([0.1, 0.2, 0.3]), "a readme about a trading bot");
    expect(vector).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws if the model returns no vector", async () => {
    const ai = { run: async () => ({ data: [] }) } as unknown as Ai;
    await expect(embedText(ai, "text")).rejects.toThrow(/no embedding vector/);
  });

  it("truncates long text before sending it to the model", async () => {
    let sentText = "";
    const ai = {
      run: async (_model: string, input: { text: string[] }) => {
        sentText = input.text[0] ?? "";
        return { data: [[0.5]] };
      },
    } as unknown as Ai;
    await embedText(ai, "x".repeat(5000));
    expect(sentText.length).toBeLessThanOrEqual(2000);
  });
});

describe("filterRelevantMatches", () => {
  const matches = [
    { id: "self", score: 0.99, metadata: { repo: "acme/self", category: "other" } },
    { id: "high-match", score: 0.91, metadata: { repo: "acme/scam-clone", category: "crypto-trading-bot" } },
    { id: "low-match", score: 0.4, metadata: { repo: "acme/unrelated", category: "other" } },
  ] as unknown as VectorizeMatches["matches"];

  it("excludes the component being classified", () => {
    const result = filterRelevantMatches(matches, "self");
    expect(result.find((m) => m.componentId === "self")).toBeUndefined();
  });

  it("excludes matches below the similarity threshold", () => {
    const result = filterRelevantMatches(matches, "self");
    expect(result.find((m) => m.componentId === "low-match")).toBeUndefined();
  });

  it("surfaces repo and category from metadata for matches that pass", () => {
    const result = filterRelevantMatches(matches, "self");
    expect(result).toEqual([
      { componentId: "high-match", score: 0.91, repo: "acme/scam-clone", category: "crypto-trading-bot" },
    ]);
  });

  it("omits repo/category when metadata is missing or the wrong type", () => {
    const noMeta = [{ id: "m1", score: 0.9 }] as unknown as VectorizeMatches["matches"];
    const result = filterRelevantMatches(noMeta, "self");
    expect(result).toEqual([{ componentId: "m1", score: 0.9, repo: undefined, category: undefined }]);
  });
});
