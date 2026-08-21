// Dockerless build for the Go/Rust E2B sandbox templates, using E2B's
// Build System 2.0 (`Template.build()` -- ships in `e2b` SDK >= 2.3.0;
// this repo's relay/package.json pins 2.38.0, confirmed installed). Builds
// run on E2B's own infrastructure, not locally -- no Docker daemon needed,
// unlike the `e2b template build` CLI path this directory's README
// previously documented as the only option (see git history / relay's own
// comment in e2b-run.ts). Requires E2B_API_KEY in the environment --
// Template.build() falls back to that env var when no apiKey option is
// passed (see the `e2b` package's ConnectionOpts type).
//
// Reuses the existing e2b.Dockerfile files verbatim via fromDockerfile() --
// same image definitions as before, just built remotely instead of on a
// local machine.
//
// Run: npx tsx src/sandbox/templates/build-templates.ts [stack ...]
//   e.g. npx tsx src/sandbox/templates/build-templates.ts go rust
// With no arguments, builds both go and rust -- the two stacks with no
// working template today. node/python are NOT part of this script: they
// already run on E2B's stock "base" template (verified live per
// relay/src/e2b-run.ts's E2B_TEMPLATE_NAMES comment) and don't need a
// custom build.
//
// Not yet run end to end -- no E2B_API_KEY was available in the environment
// this was written in. The Dockerfile-reuse and Template.build() call shape
// are verified against the installed SDK's type definitions
// (relay/node_modules/e2b/dist/index.d.ts), not against a live build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultBuildLogger, Template } from "e2b";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STACKS = ["go", "rust"] as const;
type BuildableStack = (typeof STACKS)[number];

function isBuildableStack(value: string): value is BuildableStack {
  return (STACKS as readonly string[]).includes(value);
}

// Must match relay/src/e2b-run.ts's E2B_TEMPLATE_NAMES exactly -- that map
// is what Sandbox.create() looks up at verification time, so the name a
// build registers here has to line up with what that file expects.
const TEMPLATE_NAME: Record<BuildableStack, string> = {
  go: "go",
  rust: "rust",
};

async function buildStack(stack: BuildableStack): Promise<void> {
  const dockerfilePath = join(__dirname, stack, "e2b.Dockerfile");
  const dockerfileContent = readFileSync(dockerfilePath, "utf8");
  const template = Template().fromDockerfile(dockerfileContent);

  console.log(`Building ${stack} -> template name "${TEMPLATE_NAME[stack]}"...`);
  const info = await Template.build(template, TEMPLATE_NAME[stack], {
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
  });
  console.log(`Built ${stack}: templateId=${info.templateId} name=${info.name}`);
}

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.error(
      "E2B_API_KEY is not set -- Template.build() needs it (reads the env var directly; no local Docker required).",
    );
    process.exit(1);
  }

  const requested = process.argv.slice(2);
  if (requested.some((s) => !isBuildableStack(s))) {
    console.error(`Unknown stack requested -- expected one or more of: ${STACKS.join(", ")}`);
    process.exit(1);
  }
  const targets = requested.length > 0 ? (requested as BuildableStack[]) : STACKS;

  for (const stack of targets) {
    await buildStack(stack);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
