# Methodology corrections, found by running enough real repos

Two signals used confidently in earlier entries turn out to be weaker than
they looked, once tested against enough real, diverse evidence. Recording
these precisely so later entries (and anyone reading this log) don't
over-read them the way the earlier entries implicitly did.

## `smoke:pass` means "install succeeded," not "claims verified"

**Case: `Graphify-Labs/graphify`** (componentId `8ed2b195-772a-4a9c-a99c-35d8cd81aac5`)
-- the single most suspicious repo found all night by metadata alone: an
org created ~6 weeks before this test, 2 repos, 369 followers, yet this
one repo already at 104,336 stars / 10,148 forks on an 868-file
codebase. Claims (from classify): "maps code, docs, PDFs, images, and
videos into a knowledge graph," queryable via CLI.

It got `smoke:pass`. Reading the actual evidence
(`/evidence/8ed2b195-.../smoke/stdout.log`) shows why: the smoke tier's
Python install command is `pip install '.[all]' || pip install .` --
`pip install graphifyy` succeeded (it pulled in ~30 tree-sitter language
grammars plus networkx/rapidfuzz/numpy and built cleanly), and that
*is* the entire smoke check for this stack. **Nothing in this pipeline's
`smoke:pass` tier actually runs the tool against real input and checks the
output** -- that deeper check (the capability tier, real fixtures,
pass/partial/fail verdicts) only exists for the `document-parsing-conversion`
category (`CAPABILITY_TIER_CATEGORY` in `src/types.ts`). For every other
category, `smoke:pass` is a real, meaningful signal ("this is genuinely
installable code, not a README-only repo like the crypto-bot entries") --
but it is not evidence the tool does what it claims, and shouldn't be
read as such. Graphify's star/org-age mismatch is still unexplained and
still worth treating with skepticism; `smoke:pass` here just means "don't
conflate 'not vaporware' with 'the 104k stars are earned.'"

**Correction for future entries:** state `smoke:pass` findings as "real,
installable code" -- never as "verified to work" -- outside the
document-parsing-conversion category.

## Empty `cliInvocation.command` means "no CLI entrypoint," not always "no code"

Every crypto-bot entry so far used an empty `cliInvocation.command` as
part of the vaporware case, alongside the zero-file repo tree -- correct
in those cases, but for the wrong generalizable reason.

**Case: `nikitaxru/tbank-mobile-api`** (componentId
`8f63d7dd-0de1-49c3-b62e-3ae5c2fdd3fe`) -- real code, MIT license, real
substance (OAuth PKCE + SMS auth flows, device fingerprinting, typed
immutable dataclasses, token refresh, rate limiting -- reverse-engineered
from a banking app's mobile API). `cliInvocation.command` still came back
`""`. Not because there's nothing to run -- because it's a *library*
(`import` in Python code), not a CLI tool, so there is no shell command to
extract from its README's quick start in the first place. The classify
prompt asks for "the verbatim usage/CLI example" -- a library's quick
start is Python, not a shell invocation, so an empty result here is the
*correct* answer to the question asked, not a red flag.

**Correction for future entries:** empty `cliInvocation.command` is only
meaningful *combined with* a thin/single-file repo tree (as in the crypto
entries). On its own, check whether the repo is a library before treating
it as a vaporware signal.

## Also this batch

- `0xtbug/unofficial-pddikti-api` failed sanity outright: `"no commit
  history beyond an initial commit"` -- a real sanity-tier check that
  hadn't fired in any prior entry. 66 stars on a single-commit repo is
  itself worth noting as a pattern to watch for, separate from this
  specific repo.
- `KeygraphHQ/shannon` (46,551★, claims to autonomously find *and execute*
  real exploits against live web apps) also got `smoke:pass` -- same
  caveat as Graphify applies: this confirms `npm install` succeeds, not
  that the exploit-execution claims hold up. Real `cliInvocation`
  extracted (`npx @keygraph/shannon start -u <url> -r <repo>`), which at
  least confirms it's shaped like a real tool, not a marketing shell.

Both corrections above are now part of the process memory for this
project, not just this file -- see the Xapi memory directory.
