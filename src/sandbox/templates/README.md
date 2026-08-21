# E2B sandbox templates

Four minimal templates, one per stack `stack-detect.ts` can identify. Each
is just the language runtime + git -- no network-restriction scripting
inside the image, because egress is enforced by E2B's platform-level
`network.allowOut` at `Sandbox.create()` time (see `relay/src/e2b-run.ts`
and `src/sandbox/egress-policy.ts`), not by anything baked into the
template.

**Current state, concretely** (`relay/src/e2b-run.ts`'s `E2B_TEMPLATE_NAMES`
map, verified live): `node` and `python` need no custom build at all --
E2B's stock `"base"` template already ships Python 3.11+pip and Node
20+npm. Only `go` and `rust` are missing; `E2B_TEMPLATE_NAMES` maps them to
template names (`"go"`, `"rust"`) that don't exist on E2B's platform yet,
which is why every Go/Rust repo stops at `smoke:unsupported_stack` today.
The two Dockerfiles in this directory (`go/e2b.Dockerfile`,
`rust/e2b.Dockerfile`) are ready; nobody has run a build against them.

## Building go/rust -- no local Docker required

E2B shipped "Build System 2.0": `Template.build()`, part of the `e2b` SDK
(`^2.38.0` here, `devDependencies` at the repo root) builds happen on E2B's
own infrastructure, not on your machine -- this replaced the old
`npx @e2b/cli template build` CLI path, which needed a local Docker daemon
to build the image before pushing it. `src/sandbox/templates/build-templates.ts`
reuses the existing Dockerfiles verbatim (`Template().fromDockerfile(...)`)
so nothing about the image definitions changes, just how they're built:

```bash
E2B_API_KEY=... npm run build:sandbox-templates        # builds both go and rust
E2B_API_KEY=... npx tsx src/sandbox/templates/build-templates.ts go   # one stack
```

The template names it registers (`go`, `rust`) are already what
`relay/src/e2b-run.ts`'s `E2B_TEMPLATE_NAMES` expects -- no name-mapping
step needed once this runs. **Not yet run end to end** -- verified against
the installed SDK's type definitions
(`relay/node_modules/e2b/dist/index.d.ts`) and confirmed it fails cleanly
with a clear message when `E2B_API_KEY` is unset (the only credential this
needs), not against a real build. Whoever has `E2B_API_KEY` should run it
and confirm live, then update this note.

## If you'd rather use the old CLI path

`npx @e2b/cli template build` still exists and still needs local Docker.
Same Dockerfiles, same `--cpu-count 2 --memory-mb 2048`. `--dockerfile
e2b.Dockerfile` from inside `src/sandbox/templates/go/` (or `rust/`), name
the template `go` / `rust` to match `E2B_TEMPLATE_NAMES`. This generates an
`e2b.toml` in the directory -- intentionally not hand-written here, since
its exact schema is CLI-tool-owned and auto-populated (team ID, generated
template ID, etc.); confirm current flags with
`npx @e2b/cli template build --help`.

## Resource limits

`--cpu-count` / `--memory-mb` at template-build time are what actually
bound a sandbox's resources -- `Sandbox.create()` doesn't take a per-call
override (see the SDK's `SandboxOpts` type). `RunRequest.resourceLimits`
sent from the Workflow is threaded through mostly as evidence/documentation
of what was *intended*; if you need per-repo resource tiers, that requires
either multiple templates per stack or E2B adding a create()-time override,
whichever ships first.
