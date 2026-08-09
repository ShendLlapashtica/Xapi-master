# Follow-up: `getgrass-bot-js`'s "stack-detection gap" resolved -- not a bug

The agent-scraping/passive-income batch entry flagged `cmalf/getgrass-bot-js`
hitting `smoke:unsupported_stack` despite being Node.js as "a possible
stack-detection gap distinct from the known Go/Rust/Lua template
bottleneck." Checked the actual repo tree rather than leave that open:

```
Extention-Version-v0.1/configuration.js
Extention-Version-v0.1/main.js
Extention-Version-v0.1/package.json   <- the only manifest in the repo
Extention-Version-v0.1/proxy.txt
README.md
SCRIPT-V0.2/getGrass_Desktop.zip
SCRIPT-V0.3/Update-getgrass-V0.3.zip
SCRIPT-V0.3.1-Minor/Minor-Update-getgrass-bot-v0.3.1.zip
```

**Not a pipeline bug.** `package.json` sits inside `Extention-Version-v0.1/`,
not the repo root -- `stack-detect.ts` checks root-level files by design
(consistent across every stack), and correctly found nothing there. The
repo's actual structure is the anomaly: no root manifest, and "releases"
shipped as opaque `.zip` archives under version-named folders instead of
trackable source in git history. That's a distribution pattern worth
noting on its own -- a from-source dependency graph over multiple `.zip`
drops means nobody (this pipeline included) can verify what's actually
inside without unzipping and re-auditing each release by hand, which
somewhat undercuts "open source" as a trust signal for this repo
specifically, independent of whether the bot itself works as claimed.

**Correction for the pattern-matching notes**: `smoke:unsupported_stack`
on a repo whose language shows as Node/Python on GitHub (not just
Go/Rust/etc.) is worth a quick root-tree check before assuming a template
gap -- it can also mean the manifest is nested, which is itself a signal
(unconventional structure) rather than noise.
