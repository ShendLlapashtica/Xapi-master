// One-time (or re-run-when-roster-changes) setup script: reads
// seed/accounts.seed.json and POSTs it to the deployed Worker's
// /admin/accounts/seed route. No numeric x_user_id resolution needed --
// polling goes through rettiwt-api, which searches by username directly
// (see src/listener/x-client.ts).
//
// Usage: WORKER_URL=https://xapi.<subdomain>.workers.dev ADMIN_TOKEN=... npm run seed:accounts

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WORKER_URL = process.env.WORKER_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!WORKER_URL || !ADMIN_TOKEN) {
  console.error("WORKER_URL and ADMIN_TOKEN environment variables are required");
  process.exit(1);
}

const seedFilePath = fileURLToPath(new URL("../seed/accounts.seed.json", import.meta.url));

async function main(): Promise<void> {
  const raw = await readFile(seedFilePath, "utf-8");
  const { accounts } = JSON.parse(raw) as { accounts: Array<{ handle: string }> };

  const placeholders = accounts.filter((a) => a.handle.startsWith("example_handle"));
  if (placeholders.length > 0) {
    console.error(
      `${placeholders.length} account(s) still have placeholder handles -- edit seed/accounts.seed.json first.`,
    );
    process.exit(1);
  }

  const res = await fetch(new URL("/admin/accounts/seed", WORKER_URL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ accounts }),
  });

  if (!res.ok) {
    console.error(`seed failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const body = (await res.json()) as { seeded: number };
  console.log(`seeded ${body.seeded} account(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
