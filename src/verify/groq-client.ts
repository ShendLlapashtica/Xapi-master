import { z } from "zod";
import { CATEGORIES, type Classification } from "../types";
import type { GroqChatCompletionResponse, GroqMessage } from "./groq-client.types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const MAX_ATTEMPTS = 2; // one retry on a transport/parse hiccup

const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  claims: z.array(z.string()),
  mechanismSummary: z.string(),
  cliInvocation: z.object({
    command: z.string(),
    outputMode: z.enum(["stdout", "file"]),
    outputPathTemplate: z.string().nullable(),
  }),
});

// JSON Schema mirror of ClassificationSchema, for Groq's structured-outputs
// mode (response_format: json_schema, strict: true) -- with strict mode the
// model is constrained to emit exactly this shape, so (unlike a plain
// prompt-and-hope approach) malformed JSON is not a realistic failure mode.
// zod is still applied as a defense-in-depth check, not the primary guard.
const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    claims: { type: "array", items: { type: "string" } },
    mechanismSummary: { type: "string" },
    cliInvocation: {
      type: "object",
      properties: {
        command: { type: "string" },
        outputMode: { type: "string", enum: ["stdout", "file"] },
        outputPathTemplate: { type: ["string", "null"] },
      },
      required: ["command", "outputMode", "outputPathTemplate"],
      additionalProperties: false,
    },
  },
  required: ["category", "claims", "mechanismSummary", "cliInvocation"],
  additionalProperties: false,
} as const;

export interface GroqClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  model?: string;
}

// Distinguished from a generic failure so callers (verify-workflow.ts) can
// let the Workflow's own step-level retry/backoff handle spacing out
// attempts, rather than burning classifyReadme's own MAX_ATTEMPTS
// back-to-back into the same still-active rate-limit window -- confirmed
// live: two internal retries with no delay between them both hit the same
// 429, when Groq's own response said retrying in ~30s would have worked.
export class RateLimitError extends Error {}

export type ParsedClassification = Omit<Classification, "rawResponseEvidenceKey">;

export interface ClassifyReadmeResult {
  classification: ParsedClassification;
  rawResponseText: string;
}

// Classify tier (BRIEF.md §2 "Understand"), running on Groq's free tier
// instead of the brief's original Anthropic choice -- see README.md's
// "Known deviations from BRIEF.md" for why. Asks for a category, claims, a
// mechanism summary, and the verbatim CLI/usage example from the README's
// Quick Start, since that's the input the capability tier runs against
// unseen fixtures.
export async function classifyReadme(
  readmeText: string,
  options: GroqClientOptions,
): Promise<ClassifyReadmeResult> {
  const messages: GroqMessage[] = [{ role: "user", content: buildPrompt(readmeText) }];
  let lastRawText = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const rawText = await callChatCompletions(messages, options);
      lastRawText = rawText;
      const classification = ClassificationSchema.parse(JSON.parse(rawText));
      return { classification, rawResponseText: rawText };
    } catch (err) {
      if (err instanceof RateLimitError) throw err; // let the step-level retry space this out
      lastError = err;
    }
  }

  throw new Error(
    `classifyReadme: failed after ${MAX_ATTEMPTS} attempts (${String(lastError)}). Last response: ${lastRawText.slice(0, 500)}`,
  );
}

function buildPrompt(readmeText: string): string {
  return `You are classifying an open-source repository from its README for a component catalog.

Read the README below and extract:
- category: the single best-fitting category for this tool
- claims: a short list of what the tool claims to do
- mechanismSummary: a plain-language summary of how it works
- cliInvocation.command: the verbatim usage/CLI example from the README's Quick Start section, using {input} and {output} as placeholders for file paths
- cliInvocation.outputMode: "stdout" if the tool prints its result, "file" if it writes an output file
- cliInvocation.outputPathTemplate: e.g. "{basename}.md" when outputMode is "file"; null when outputMode is "stdout"

README:
"""
${readmeText.slice(0, 15000)}
"""`;
}

async function callChatCompletions(
  messages: GroqMessage[],
  options: GroqClientOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(GROQ_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      max_completion_tokens: 2048,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          strict: true,
          schema: CLASSIFICATION_JSON_SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      throw new RateLimitError(`Groq chat completions rate-limited: ${text}`);
    }
    throw new Error(`Groq chat completions failed: ${res.status} ${text}`);
  }

  const body = (await res.json()) as GroqChatCompletionResponse;
  const content = body.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq chat completions returned no content");
  }
  return content;
}
