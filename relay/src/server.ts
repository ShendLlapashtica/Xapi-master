import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { runInSandbox } from "./e2b-run.js";
import type { RunRequest } from "./types.js";

const PORT = Number(process.env.PORT ?? 8080);
const E2B_API_KEY = process.env.E2B_API_KEY;
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET;

if (!E2B_API_KEY) {
  throw new Error("E2B_API_KEY is required");
}
if (!RELAY_SHARED_SECRET) {
  throw new Error("RELAY_SHARED_SECRET is required");
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/run", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  if (authHeader !== `Bearer ${RELAY_SHARED_SECRET}`) {
    return c.body("Unauthorized", 401);
  }

  let body: RunRequest;
  try {
    body = await c.req.json<RunRequest>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  try {
    const result = await runInSandbox(body, E2B_API_KEY as string);
    return c.json(result);
  } catch (err) {
    console.error("run failed", err);
    return c.json({ error: err instanceof Error ? err.message : "unknown error" }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`xapi e2b relay listening on :${info.port}`);
});
