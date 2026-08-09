# Batch: no-code builders, game engines, computer-use agents, observability

Nine repos, closing out this session's category breadth push (no-code/
low-code, game engines/creative tools, and the previously-researched
computer-use / observability candidates queued but not yet run).

| Repo | Stars | Result | Note |
|---|---|---|---|
| `trycua/cua` | 21,043 | `smoke:pass` | Real substance: OS-agnostic computer-use sandbox suite, VM driver, benchmark harness, `Lume` (Apple Virtualization.Framework wrapper). Real `cliInvocation`. Notable as a meta case -- built on the same category of infra (sandboxed agent execution) this pipeline itself runs on. |
| `DavidHDev/canvas-ui` | 3,633 | `smoke:fail` | Node/TS canvas component library -- installed, build step failed. |
| `totalumlabs/ai-app-builder-open` | 29 | `smoke:fail` | No-code AI app builder, small project, failed at build. |
| `simstudioai/sim` | 29,382 | `smoke:fail` | Funded no-code workflow-builder startup -- failed despite real backing; worth a closer look at *why* separately, since funded/active orgs failing smoke is a different signal than an unknown repo failing. |
| `ammaarreshi/Generals-Mac-iOS-iPad` | 1,551 | `smoke:unsupported_stack` | C++/Obj-C game engine port (real EA GPLv3 source via GeneralsX) -- language gap, not a finding about the repo. |
| `brettchalupa/usagi` | 835 | `smoke:unsupported_stack` | Lua game engine -- same, language gap. |
| `rudderlabs/rudder-server` | 4,465 | `smoke:unsupported_stack` | Go, established Segment-alternative -- same. |
| `TencentCloud/TencentDB-Agent-Memory` | 18,194 | `smoke:unsupported_stack` | real Tencent org, language/stack gap prevented a deeper check. |
| `pranshuparmar/witr` | 20,118 | `smoke:unsupported_stack` | Go, the "20k stars in 7.5 months, single dev" outlier flagged by the research pass -- still unresolved, stack gap blocked verification rather than confirming or denying the suspicion either way. |

## What this batch mainly demonstrates

Five of nine hit `smoke:unsupported_stack` -- not because anything's wrong
with those repos, but because this pipeline's E2B sandbox only has working
smoke templates for Node/Python (see the go/rust routing comment in
`verify-workflow.ts`, and multiple earlier entries). Game engines
(C++/Lua), Go services, and several agent-memory tools all fall outside
that today. This is the clearest evidence yet that **language-template
coverage, not repo quality, is now the main bottleneck** on how much of
this log can carry a real verdict rather than "sanity+classify only."
Building Go and a couple of the more common compiled-language E2B
templates would very likely raise the batch's verdict rate more than
finding more candidate repos would.

Category graph: 41 nodes as of this batch (from 30 at the start of this
cycle).
