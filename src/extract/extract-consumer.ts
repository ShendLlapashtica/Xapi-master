import { evidencePrefix } from "../catalog/evidence-store";
import {
  findComponentByRepo,
  insertDiscoveredComponent,
  insertSourcePost,
  type NewSourcePost,
} from "../catalog/components-repo";
import type { Env, RawPostMessage } from "../types";
import { canonicalizeGithubUrl, type CanonicalGithubRepo } from "./github-url";

// Consumer for the "raw-posts" queue: finds GitHub links, canonicalizes,
// dedupes against the catalog. Per-message try/catch (not batch-level) is
// mandatory here -- an uncaught throw retries the *whole batch*, which would
// re-run (and double-insert components for) every already-succeeded message
// in that batch. See BRIEF.md §2 "Detect & extract".
export async function handleRawPostsBatch(
  batch: MessageBatch<RawPostMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processRawPost(message.body, env);
      message.ack();
    } catch (err) {
      console.error("extract-consumer: failed to process message", message.id, err);
      message.retry();
    }
  }
}

async function processRawPost(post: RawPostMessage, env: Env): Promise<void> {
  const repos = dedupeCanonicalRepos(post.urls);
  if (repos.length === 0) return;

  for (const repo of repos) {
    await discoverRepo(repo, {
      postId: post.postId,
      postUrl: post.postUrl,
      authorHandle: post.authorHandle,
      postedAt: post.postedAt,
    }, env);
  }
}

export interface DiscoverRepoResult {
  componentId: string;
  isNew: boolean;
}

// Shared by the queue path above and src/api/admin-route.ts's
// /admin/verify-repo (a manual stand-in for the Listen stage when there's
// no X API access to actually discover posts) -- "find or insert the
// component, record the source post, enqueue verification if new" is the
// same operation regardless of where the repo URL came from.
export async function discoverRepo(
  repo: CanonicalGithubRepo,
  sourcePost: NewSourcePost,
  env: Env,
): Promise<DiscoverRepoResult> {
  const existing = await findComponentByRepo(env.DB, repo.owner, repo.repo);

  if (existing) {
    await insertSourcePost(env.DB, existing.id, sourcePost);
    return { componentId: existing.id, isNew: false };
  }

  const componentId = crypto.randomUUID();
  await insertDiscoveredComponent(env.DB, {
    id: componentId,
    name: repo.repo,
    repoOwner: repo.owner,
    repoName: repo.repo,
    repoUrl: repo.canonicalUrl,
    evidencePrefix: evidencePrefix(componentId),
  });
  await insertSourcePost(env.DB, componentId, sourcePost);
  await env.VERIFY_REQUESTS.send({
    componentId,
    repoOwner: repo.owner,
    repoName: repo.repo,
    repoUrl: repo.canonicalUrl,
  });

  return { componentId, isNew: true };
}

function dedupeCanonicalRepos(urls: string[]): CanonicalGithubRepo[] {
  const seen = new Map<string, CanonicalGithubRepo>();
  for (const url of urls) {
    const canonical = canonicalizeGithubUrl(url);
    if (!canonical) continue;
    seen.set(canonical.canonicalUrl, canonical);
  }
  return [...seen.values()];
}
