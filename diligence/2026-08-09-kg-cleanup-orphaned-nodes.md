# KG cleanup: 8 orphaned/duplicate category nodes removed

While waiting out the Groq daily quota reset -- pure D1 cleanup, no
classify calls needed. Node count: 64 -> 56.

## What was removed

1. **`python-object-oriented-agent-framework`** -- exact-duplicate meaning
   of `object-oriented-llm-agent-framework`, same parent clade
   (`ai-agent-tooling`). Zero components pointed to it; the real
   component (`NVIDIA-NeMo/labs-OO-Agents`) links to the other one.
   Almost certainly two different classify attempts on the same repo
   (one before a Groq rate-limit retry, one after) proposing slightly
   different `suggestedCategory` wording for the same tool.
2. **`ai-agent-crm`**, **`ai-agent-workflow-orchestrator`** -- zero
   components, zero children, no references anywhere in `diligence/` or
   `claudeagent2secureme`.
3. **`local-ai-agent-desktop-client`**, **`canvas-ui-component-library`**,
   **`ai-agent-meta-harness`**, **`code-minimization-plugin`**,
   **`llm-proxy-router`** -- same pattern, all from the original
   pre-hierarchy backfill (`scripts/backfill-category-hierarchy.sql`),
   zero real usage, zero references.

## What was deliberately kept

`semantic-api-reverse-engineering` is also a zero-component leaf, but
it's not an orphan -- it's the intentional case-study node from
`2026-08-09-case-study-encar-semantic-model.md`, documented as
"no repo" on purpose. Checked every deletion candidate against
`diligence/` and `claudeagent2secureme` for references before removing
anything, specifically to not repeat this mistake.

## Method (repeatable)

```sql
-- Find candidates: no components, no children, i.e. genuinely dead ends
SELECT c.name, c.id FROM categories c
WHERE NOT EXISTS (SELECT 1 FROM components WHERE category_node_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM categories c2 WHERE c2.parent_id = c.id)
  AND c.parent_id IS NOT NULL;
```
Then grep `diligence/` and `claudeagent2secureme` for each candidate name
before deleting -- a node with zero DB references can still be a real,
intentional reference point in prose.

## Why this keeps happening

Orphan leaf nodes appear whenever a classify run gets retried (Groq
rate-limit backoff, malformed JSON) and the model's open-ended
`suggestedCategory`/`suggestedParentClade` output isn't perfectly
deterministic across attempts -- an earlier attempt's proposed node can
get created via `findOrCreateCategoryNode` and then never referenced if
a later attempt's wording differs slightly. Not a bug worth fixing in
code (the alternative is caching the first attempt's classification and
never re-asking the model, which would also suppress legitimate
reclassification) -- a periodic sweep like this one is the right fix,
not a workflow change.
