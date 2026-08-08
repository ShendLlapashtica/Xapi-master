import { describe, expect, it } from "vitest";
import { classifyReadme, RateLimitError } from "./groq-client";
import { sequenceFetch } from "../../test/helpers/mock-fetch";

function groqResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_CLASSIFICATION = {
  category: "document-parsing-conversion",
  suggestedCategory: "pdf-conversion",
  claims: ["converts PDFs to markdown"],
  mechanismSummary: "wraps pdfminer and a layout model",
  cliInvocation: {
    command: "docparse convert {input} -o {output}",
    outputMode: "file",
    outputPathTemplate: "{basename}.md",
  },
};

describe("classifyReadme", () => {
  it("parses a valid structured-output response", async () => {
    const fetchImpl = sequenceFetch([groqResponse(JSON.stringify(VALID_CLASSIFICATION))]);
    const result = await classifyReadme("# docparse\n\nUsage: docparse convert x", {
      apiKey: "k",
      fetchImpl,
    });
    expect(result.classification.category).toBe("document-parsing-conversion");
    expect(result.classification.suggestedCategory).toBe("pdf-conversion");
    expect(result.classification.cliInvocation.command).toBe("docparse convert {input} -o {output}");
  });

  it("sends the request with json_schema structured outputs and bearer auth", async () => {
    const fetchImpl = sequenceFetch([groqResponse(JSON.stringify(VALID_CLASSIFICATION))]);
    await classifyReadme("readme text", { apiKey: "k", fetchImpl });

    const [urlArg, initArg] = (fetchImpl as ReturnType<typeof import("vitest").vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(urlArg).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((initArg.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(initArg.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("retries once on a transient malformed-JSON response and succeeds on the second attempt", async () => {
    const fetchImpl = sequenceFetch([
      groqResponse("not valid json"),
      groqResponse(JSON.stringify(VALID_CLASSIFICATION)),
    ]);
    const result = await classifyReadme("readme text", { apiKey: "k", fetchImpl });
    expect(result.classification.category).toBe("document-parsing-conversion");
  });

  it("retries on a schema violation and succeeds on the second attempt", async () => {
    const invalid = { ...VALID_CLASSIFICATION, category: "not-a-real-category" };
    const fetchImpl = sequenceFetch([
      groqResponse(JSON.stringify(invalid)),
      groqResponse(JSON.stringify(VALID_CLASSIFICATION)),
    ]);
    const result = await classifyReadme("readme text", { apiKey: "k", fetchImpl });
    expect(result.classification.category).toBe("document-parsing-conversion");
  });

  it("throws after exhausting retries on persistent failures", async () => {
    const fetchImpl = sequenceFetch([groqResponse("not json"), groqResponse("still not json")]);
    await expect(classifyReadme("readme text", { apiKey: "k", fetchImpl })).rejects.toThrow(
      /failed after 2 attempts/,
    );
  });

  it("throws on a non-ok, non-429 Groq response after exhausting retries", async () => {
    const fetchImpl = sequenceFetch([
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    ]);
    await expect(classifyReadme("readme text", { apiKey: "k", fetchImpl })).rejects.toThrow(
      /failed after 2 attempts/,
    );
  });

  it("throws RateLimitError immediately on 429, without burning its own retry budget", async () => {
    const fetchImpl = sequenceFetch([new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })]);
    await expect(classifyReadme("readme text", { apiKey: "k", fetchImpl })).rejects.toThrow(RateLimitError);
    // Only the single call above was ever made -- no wasted second attempt
    // against a rate limit that hasn't had time to reset.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
