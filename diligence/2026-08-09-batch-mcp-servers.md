# Batch: MCP servers

New category tonight -- Model Context Protocol servers, the connective layer
between LLM agents and external tools/data. Both completed results are
legitimate, real tools; no scam pattern in this batch.

| Repo | Stars | Result | Note |
|---|---|---|---|
| `shlokkhemani/rabbithole` | 299 | `smoke:pass` | Browser-based infinite-canvas Q&A tool over documents (PDF/Markdown/URL), IndexedDB-persisted, with an MCP server letting terminal agents drive the canvas. Real `cliInvocation`: `claude mcp add rabbithole -- npx -y github:shlokkhemani/rabbithole`. |
| `JesusRS1/stock-trade-finance-api` | 139 | `smoke:fail` | Wraps the Tiingo financial-data API as MCP tools (stock prices, news, forex, fundamentals). Failed smoke -- installed but the build/run step didn't complete cleanly; real code, not a scam pattern (Tiingo is a real, legitimate financial data provider). |
| `livetennisapi/livetennisapi-mcp` | 190 | pending | |
| `pueschel88/Tradingview-MCP` | 132 | pending | |

Both completed repos correctly reused existing top-level clades
(`document-knowledge-tools`, `dev-infra-data`) rather than creating
near-duplicates -- more live confirmation the hierarchy resolver is
working as intended across a genuinely new category, not just the ones it
was tested against originally.
