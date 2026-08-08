import { vi } from "vitest";

// Minimal injectable-fetch stub for testing request-construction and
// response-parsing in the X/GitHub/Claude/E2B clients without any live
// network access. Captures the last call for assertions.
export function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

export function textFetch(status: number, body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

export function sequenceFetch(responses: Response[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const res = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return res;
  }) as unknown as typeof fetch;
}
