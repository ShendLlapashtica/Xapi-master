-- One-time backfill: the category graph shipped 2026-08-08 (commit dbb6d5c)
-- created every node top-level (parent_id NULL) -- the classify tier didn't
-- resolve a parent clade until 2026-08-09's suggestedParentClade change.
-- This re-parents the 47 nodes that existed before that change under 8
-- thematic clades, curated by hand from the real node names and the
-- diligence log's actual findings (see diligence/2026-08-09-*.md) -- not
-- generated, and not re-run automatically: going forward, new nodes get a
-- parent from the classify step itself. Safe to re-run (idempotent
-- UPDATEs), but only meant to run once against the live catalog.

INSERT INTO categories (id, name, parent_id) VALUES
  ('22e6cd05-6f6e-4f74-8640-8788b32b3663', 'ai-agent-tooling', NULL),
  ('b559e50c-1c4a-4447-bd63-be81578ab8de', 'reverse-engineered-apis', NULL),
  ('772a3208-fdd2-42ee-a44f-ba3b9cc5f807', 'document-knowledge-tools', NULL),
  ('c2236af5-fa86-4830-92e6-74945cd74975', 'dev-infra-data', NULL),
  ('e052cac7-fdb3-4c8d-8b0a-0038bb987849', 'creative-game-ui', NULL),
  ('48701127-28dd-4580-9f27-d1abdcef8a2d', 'saas-starters', NULL),
  ('285c6a88-3ca6-44ec-9e46-aff65ddac2fb', 'writing-productivity-security', NULL),
  ('c39a8a38-3598-44e3-a45d-6e4f937d834c', 'money-bait-patterns', NULL);

UPDATE categories SET parent_id = '22e6cd05-6f6e-4f74-8640-8788b32b3663' WHERE name IN (
  'agent-memory-hub','agentic-crm','ai-agent-code-optimization','ai-agent-crm','ai-agent-memory',
  'ai-agent-meta-harness','ai-agent-orchestration','ai-agent-workflow-orchestrator','ai-agent-workflow-platform',
  'ai-computer-automation','coding-agent-orchestrator','computer-use-agent','computer-use-agent-platform',
  'llm-proxy-multi-provider','llm-proxy-router','local-ai-agent-desktop-client','local-ai-agent-workflow-orchestrator',
  'local-personal-ai-assistant','python-object-oriented-agent-framework','self-hosted-multi-agent-ai-assistant'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = 'b559e50c-1c4a-4447-bd63-be81578ab8de' WHERE name IN (
  'google-photos-web-client','semantic-api-reverse-engineering','stealth-browser-automation','tbank-mobile-api-client'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = '772a3208-fdd2-42ee-a44f-ba3b9cc5f807' WHERE name IN (
  'codebase-knowledge-graph-indexer','document-to-markdown-converter','project-knowledge-graph'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = 'c2236af5-fa86-4830-92e6-74945cd74975' WHERE name IN (
  'code-minimization-plugin','customer-data-platform','data-integration-elt-platform',
  'process-causality-tracing','typescript-native-compiler'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = 'e052cac7-fdb3-4c8d-8b0a-0038bb987849' WHERE name IN (
  'ai-design-generator','canvas-ui-component-library','canvas-ui-visual-effects',
  'pixel-art-2d-game-engine','rts-game-port','text-to-image-generation'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = '48701127-28dd-4580-9f27-d1abdcef8a2d' WHERE name IN (
  'cloudflare-saas-starter','fullstack-saas-starter','prompt-to-nextjs-app-generator'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = '285c6a88-3ca6-44ec-9e46-aff65ddac2fb' WHERE name IN (
  'ai-autonomous-pentester','ai-sloppiness-removal','claude-plugin-adhd-friendly-response-formatting',
  'human-like-chinese-writing-assistant','local-meeting-recorder-transcriber'
) AND parent_id IS NULL;

UPDATE categories SET parent_id = 'c39a8a38-3598-44e3-a45d-6e4f937d834c' WHERE name IN (
  'crypto-trading-bot'
) AND parent_id IS NULL;
