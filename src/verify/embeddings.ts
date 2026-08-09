// Fuzzy pattern matching, alongside (not instead of) the exact-match
// README fingerprint in readme-fingerprint.ts. Two repos can describe the
// same scam-bait shape in completely different words -- exact-hash
// matching only catches literal template reuse, embeddings catch the
// semantic pattern. Used to flag, not to silently reuse a verdict: a
// similarity score is evidence to weigh, not proof of a match, so this
// never skips classification the way the exact-fingerprint path does.
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768 dimensions, matches the Vectorize index

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  // Model has a real input budget; the opening slice of a README (title,
  // tagline, claims) carries more classification signal per token than a
  // long install/config section further down, so truncating here rather
  // than chunking-and-averaging is a deliberate simplification, not an
  // oversight.
  const result = (await ai.run(EMBEDDING_MODEL, { text: [text.slice(0, 2000)] })) as {
    data: number[][];
  };
  const vector = result.data[0];
  if (!vector) {
    throw new Error("embedText: Workers AI returned no embedding vector");
  }
  return vector;
}

export interface SimilarityMatch {
  componentId: string;
  score: number;
  repo: string | undefined;
  category: string | undefined;
}

// Excludes the component being classified (Vectorize will happily return a
// self-match once this component's own vector is upserted) and applies the
// threshold here rather than trusting a caller-supplied topK to already be
// relevant -- 0.85 on bge-base cosine similarity is "same domain and
// mechanism," not "same wording," based on this project's own claims text.
const SIMILARITY_THRESHOLD = 0.85;

export function filterRelevantMatches(
  matches: VectorizeMatches["matches"],
  excludeComponentId: string,
): SimilarityMatch[] {
  return matches
    .filter((m) => m.id !== excludeComponentId && m.score >= SIMILARITY_THRESHOLD)
    .map((m) => ({
      componentId: m.id,
      score: m.score,
      repo: typeof m.metadata?.repo === "string" ? m.metadata.repo : undefined,
      category: typeof m.metadata?.category === "string" ? m.metadata.category : undefined,
    }));
}
