import { getAgentByName } from "agents";
import { handleAdminAccountsSeed, handleAdminVerifyRepo, handleAdminAuditDomain } from "./admin-route";
import { handleComponentsRequest } from "./components-route";
import { handleEvidenceRequest } from "./evidence-route";
import { handleDomainsRequest } from "./domains-route";
import { handleAdminApprovePost, handleAdminListPosts, handleAdminRejectPost } from "./posts-route";
import type { Env } from "../types";

const POST_APPROVE_PATH = /^\/admin\/posts\/([^/]+)\/approve$/;
const POST_REJECT_PATH = /^\/admin\/posts\/([^/]+)\/reject$/;

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // A bare "Not found" at the root reads as "the whole thing is down" even
  // when every real route is fine -- this gives a status view instead,
  // including which of the external-service secrets are actually
  // configured (booleans only, never the values), since "the deploy
  // succeeded" and "the pipeline can actually reach GitHub/Groq/E2B" are
  // two different questions. X_SESSION_TOKEN is optional until a dedicated
  // account's session is set up -- see README.md's "X integration".
  if (request.method === "GET" && url.pathname === "/") {
    return Response.json({
      name: "xapi",
      status: "deployed",
      secretsConfigured: {
        X_SESSION_TOKEN: Boolean(env.X_SESSION_TOKEN),
        GITHUB_TOKEN: Boolean(env.GITHUB_TOKEN),
        GROQ_API_KEY: Boolean(env.GROQ_API_KEY),
        E2B_API_KEY: Boolean(env.E2B_API_KEY),
        X_POSTING_ENABLED: Boolean(env.X_POSTING_ENABLED),
      },
      endpoints: [
        "GET /components?category=&status=",
        "GET /domains?limit=&cursor=",
        "GET /evidence/*",
        "GET /admin/posts?status=&limit=&cursor= (requires Authorization: Bearer <ADMIN_TOKEN or ADMIN_READONLY_TOKEN>)",
        "POST /admin/accounts/seed (requires Authorization: Bearer <ADMIN_TOKEN>)",
        "POST /admin/listener/start (requires Authorization: Bearer <ADMIN_TOKEN>)",
        "POST /admin/verify-repo { repoUrl } (requires Authorization: Bearer <ADMIN_TOKEN>) -- manually feed a repo into the pipeline without X",
        "POST /admin/audit-domain { hostname, watched? } (requires Authorization: Bearer <ADMIN_TOKEN>) -- trigger a domain security audit; watched:true adds it to DomainAuditAgent's recurring work list",
        "POST /admin/domain-audit-agent/start (requires Authorization: Bearer <ADMIN_TOKEN>) -- bootstrap the recurring self-audit schedule",
        "POST /admin/posts/:id/approve (requires Authorization: Bearer <ADMIN_TOKEN>, and X_POSTING_ENABLED=true) -- actually post a pending draft reply",
        "POST /admin/posts/:id/reject (requires Authorization: Bearer <ADMIN_TOKEN>)",
      ],
    });
  }

  if (request.method === "GET" && url.pathname === "/components") {
    return handleComponentsRequest(request, env);
  }

  if (request.method === "GET" && url.pathname === "/domains") {
    return handleDomainsRequest(request, env);
  }
  if (request.method === "GET" && url.pathname.startsWith("/evidence/")) {
    return handleEvidenceRequest(request, env);
  }

  if (request.method === "GET" && url.pathname === "/admin/posts") {
    return handleAdminListPosts(request, env);
  }

  // First dynamic-segment admin routes in this file -- everything above is
  // exact-match. A regex capture is enough here; this file doesn't have
  // enough routes yet to justify a real router library.
  const approveMatch = url.pathname.match(POST_APPROVE_PATH);
  if (request.method === "POST" && approveMatch) {
    return handleAdminApprovePost(request, env, approveMatch[1]!);
  }
  const rejectMatch = url.pathname.match(POST_REJECT_PATH);
  if (request.method === "POST" && rejectMatch) {
    return handleAdminRejectPost(request, env, rejectMatch[1]!);
  }

  if (request.method === "POST" && url.pathname === "/admin/accounts/seed") {
    return handleAdminAccountsSeed(request, env);
  }

  if (request.method === "POST" && url.pathname === "/admin/verify-repo") {
    return handleAdminVerifyRepo(request, env);
  }

  if (request.method === "POST" && url.pathname === "/admin/audit-domain") {
    return handleAdminAuditDomain(request, env);
  }
  // Bootstraps the singleton ListenerAgent's recurring poll schedule.
  // Durable Objects are lazy -- this needs to be hit once after deploy
  // (and again if the account roster changes enough to warrant a restart,
  // though the Agent re-reads the roster from D1 on every tick regardless).
  if (request.method === "POST" && url.pathname === "/admin/listener/start") {
    const authHeader = request.headers.get("authorization") ?? "";
    if (!env.ADMIN_TOKEN || authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const agent = await getAgentByName(env.LISTENER_AGENT, "singleton");
    return agent.fetch(new Request("https://internal/start"));
  }
  // Same bootstrap shape as /admin/listener/start, for DomainAuditAgent's
  // daily self-audit schedule instead of the 15-minute X poll.
  if (request.method === "POST" && url.pathname === "/admin/domain-audit-agent/start") {
    const authHeader = request.headers.get("authorization") ?? "";
    if (!env.ADMIN_TOKEN || authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const agent = await getAgentByName(env.DOMAIN_AUDIT_AGENT, "singleton");
    return agent.fetch(new Request("https://internal/start"));
  }

  return new Response("Not found", { status: 404 });
}
