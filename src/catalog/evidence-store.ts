// Single source of truth for the evidence key-naming convention, so the API
// layer never hardcodes per-tier file names (BRIEF.md §2 "Store & serve") --
// it just lists whatever's under a component's prefix.
//
// Layout: evidence/{componentId}/{stage}/{file}
//   sanity/result.json
//   classify/readme.md, classify/response.json
//   smoke/stdout.log, smoke/stderr.log, smoke/result.json
//   capability/{fixtureId}/command.txt, stdout.log, stderr.log, output.txt, result.json

export function evidencePrefix(componentId: string): string {
  return `evidence/${componentId}/`;
}

export function evidenceKey(componentId: string, ...segments: string[]): string {
  return `${evidencePrefix(componentId)}${segments.join("/")}`;
}

export interface EvidenceWrite {
  key: string;
  body: string | ArrayBuffer;
  contentType?: string;
}

export async function writeEvidence(bucket: R2Bucket, write: EvidenceWrite): Promise<void> {
  await bucket.put(write.key, write.body, {
    httpMetadata: write.contentType ? { contentType: write.contentType } : undefined,
  });
}

export async function writeEvidenceBatch(bucket: R2Bucket, writes: EvidenceWrite[]): Promise<void> {
  await Promise.all(writes.map((w) => writeEvidence(bucket, w)));
}

// Only used by the API layer to resolve evidence links at request time --
// never hardcode a per-tier filename outside this module.
export async function listEvidenceKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed: R2Objects = await bucket.list({ prefix, cursor });
    keys.push(...listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}
