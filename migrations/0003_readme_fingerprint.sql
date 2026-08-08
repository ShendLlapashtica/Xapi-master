-- README fingerprinting for cheap duplicate/template detection -- lets the
-- classify step skip a fresh, rate-limited Groq call when a new repo's
-- README exactly matches (after normalization, see
-- src/verify/readme-fingerprint.ts) one already classified, reusing that
-- result instead of independently re-verifying. duplicate_of_component_id
-- is null for the original/first-seen instance of a template and points at
-- it for every later copy, so the distinction between "independently
-- verified" and "matched a known template" is never lost.
ALTER TABLE components ADD COLUMN readme_fingerprint TEXT;
ALTER TABLE components ADD COLUMN duplicate_of_component_id TEXT REFERENCES components(id);
CREATE INDEX idx_components_readme_fingerprint ON components(readme_fingerprint);
