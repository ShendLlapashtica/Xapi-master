import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test-only placeholder secrets -- never real credentials. Handlers
      // that need to make live calls with these are exercised via injected
      // fetch mocks, not by actually hitting X/GitHub/Groq/E2B.
      miniflare: {
        bindings: {
          X_SESSION_TOKEN: "test-x-session-token",
          GITHUB_TOKEN: "test-github-token",
          GROQ_API_KEY: "test-groq-key",
          E2B_API_KEY: "test-e2b-key",
          ADMIN_TOKEN: "test-admin-token",
          ADMIN_READONLY_TOKEN: "test-admin-readonly-token",
          RELAY_SHARED_SECRET: "test-relay-shared-secret",
        },
      },
    }),
  ],
});
