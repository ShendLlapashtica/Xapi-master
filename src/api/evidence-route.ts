import type { Env } from "../types";

const EVIDENCE_PREFIX = "evidence/";

// Streams an R2 object, restricted to keys under evidence/ -- never
// fixtures/, which holds the capability-tier inputs, not outputs.
export async function handleEvidenceRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname.replace(/^\/evidence\//, ""));

  if (!path || path.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const key = `${EVIDENCE_PREFIX}${path}`;
  const object = await env.EVIDENCE.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  return new Response(object.body, { headers });
}
