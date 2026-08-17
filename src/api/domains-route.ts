import type { Env, DomainsQueryParams } from "../types";
import { listDomains } from "../catalog/domains-repo";

const MAX_LIMIT = 25;

export async function handleDomainsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 12, MAX_LIMIT) : 12;

  const params: DomainsQueryParams = { limit, cursor };
  const result = await listDomains(env.DB, params);
  return Response.json(result);
}
