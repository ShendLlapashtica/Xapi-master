import {
  listComponents,
  listSourcePostsForComponent,
  parseCategory,
  parseClaims,
} from "../catalog/components-repo";
import { evidencePrefix, listEvidenceKeys } from "../catalog/evidence-store";
import {
  CATEGORIES,
  COMPONENT_STATUSES,
  type Category,
  type ComponentRow,
  type ComponentStatus,
  type ComponentSummaryDTO,
  type ComponentsResponse,
  type Env,
} from "../types";

export async function handleComponentsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category");
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor") ?? undefined;

  let category: Category | undefined;
  if (categoryParam !== null) {
    if (!isCategory(categoryParam)) {
      return Response.json({ error: `unknown category: ${categoryParam}` }, { status: 400 });
    }
    category = categoryParam;
  }

  let status: ComponentStatus | undefined;
  if (statusParam !== null) {
    if (!isStatus(statusParam)) {
      return Response.json({ error: `unknown status: ${statusParam}` }, { status: 400 });
    }
    status = statusParam;
  }

  const { rows, nextCursor } = await listComponents(env.DB, {
    category,
    status,
    limit: limitParam ? Number(limitParam) : undefined,
    cursor: cursorParam,
  });

  const components = await Promise.all(rows.map((row) => toComponentSummaryDTO(row, env)));

  const body: ComponentsResponse = { components, nextCursor };
  return Response.json(body);
}

async function toComponentSummaryDTO(row: ComponentRow, env: Env): Promise<ComponentSummaryDTO> {
  const prefix = evidencePrefix(row.id);
  const [sourcePosts, evidenceLinks] = await Promise.all([
    listSourcePostsForComponent(env.DB, row.id),
    listEvidenceKeys(env.EVIDENCE, prefix),
  ]);

  return {
    id: row.id,
    name: row.name,
    repo: { owner: row.repo_owner, name: row.repo_name, url: row.repo_url },
    category: parseCategory(row.category),
    claims: parseClaims(row.claims),
    mechanismSummary: row.mechanism_summary,
    tierReached: row.tier_reached,
    status: row.status,
    commitShaChecked: row.commit_sha_checked,
    discoveredAt: row.discovered_at,
    verifiedAt: row.verified_at,
    // R2 keys already look like "evidence/{componentId}/...", which is
    // exactly the path evidence-route.ts's GET /evidence/* expects after
    // its own leading slash -- do not strip the componentId back out.
    evidence: { prefix, links: evidenceLinks.map((key) => `/${key}`) },
    sourcePosts: sourcePosts.map((p) => ({
      postUrl: p.post_url,
      authorHandle: p.author_handle,
      postedAt: p.posted_at,
    })),
  };
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

function isStatus(value: string): value is ComponentStatus {
  return (COMPONENT_STATUSES as readonly string[]).includes(value);
}

