# E2B sandbox templates

Four minimal templates, one per stack `stack-detect.ts` can identify. Each
is just the language runtime + git -- no network-restriction scripting
inside the image, because egress is enforced by E2B's platform-level
`network.allowOut` at `Sandbox.create()` time (see `relay/src/e2b-run.ts`
and `src/sandbox/egress-policy.ts`), not by anything baked into the
template.

## One-time setup (per stack, once you have an E2B account)

```bash
npx @e2b/cli auth login
cd src/sandbox/templates/node
npx @e2b/cli template build --name xapi-node --dockerfile e2b.Dockerfile --cpu-count 2 --memory-mb 2048
```

Repeat for `python`, `go`, `rust` (adjust `--name` accordingly). This
generates an `e2b.toml` in each directory -- intentionally not hand-written
here, since its exact schema is CLI-tool-owned and auto-populated (team ID,
generated template ID, etc.); confirm current flags with
`npx @e2b/cli template build --help`, the CLI's own `--help` is more
current than anything written here.

The resulting template names (`xapi-node`, `xapi-python`, `xapi-go`,
`xapi-rust`) are what `relay/src/e2b-run.ts` passes as `Sandbox.create(template, ...)` --
keep them in sync with whatever `RunRequest.template` values
`src/verify/steps/smoke.ts` sends (currently the bare stack name: `"node"`,
`"python"`, `"go"`, `"rust"` -- either rename the templates to match exactly,
or add a small name-mapping table in `relay/src/e2b-run.ts` before this goes
live).

## Resource limits

`--cpu-count` / `--memory-mb` at template-build time are what actually
bound a sandbox's resources -- `Sandbox.create()` doesn't take a per-call
override (see the SDK's `SandboxOpts` type). `RunRequest.resourceLimits`
sent from the Workflow is threaded through mostly as evidence/documentation
of what was *intended*; if you need per-repo resource tiers, that requires
either multiple templates per stack or E2B adding a create()-time override,
whichever ships first.
