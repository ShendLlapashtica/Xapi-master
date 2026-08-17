import { handleRawPostsBatch } from "./extract/extract-consumer";
import { router } from "./api/router";
import { ListenerAgent } from "./listener/listener-agent";
import { E2bRelayContainer } from "./sandbox/relay-container";
import type { Env, RawPostMessage, VerifyRequestParams } from "./types";
import { VerificationWorkflow } from "./verify/verify-workflow";
import { DomainAuditWorkflow } from "./audit/domain-audit-workflow";
import { DomainAuditAgent } from "./audit/domain-audit-agent";

export { ListenerAgent, VerificationWorkflow, E2bRelayContainer, DomainAuditWorkflow, DomainAuditAgent };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return router(request, env);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    switch (batch.queue) {
      case "raw-posts":
        await handleRawPostsBatch(batch as MessageBatch<RawPostMessage>, env);
        return;
      case "verify-requests":
        await handleVerifyRequests(batch as MessageBatch<VerifyRequestParams>, env);
        return;
      default:
        console.error(`unknown queue: ${batch.queue}`);
        batch.retryAll();
    }
  },
} satisfies ExportedHandler<Env>;

// Deterministic instance id (`verify-${componentId}`) makes workflow
// creation itself idempotent -- Workflows throw on a duplicate id within
// the retention window, a second dedupe layer independent of the D1
// check-then-insert in extract-consumer.ts.
async function handleVerifyRequests(
  batch: MessageBatch<VerifyRequestParams>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await env.VERIFICATION_WORKFLOW.create({
        id: `verify-${message.body.componentId}`,
        params: message.body,
      });
      message.ack();
    } catch (err) {
      // Duplicate-id errors are expected and desired here -- a redelivered
      // queue message retrying `create()` for a workflow that's already
      // running/ran is exactly the idempotency this deterministic id is
      // for. The match is a heuristic; confirm the live Workflows API's
      // actual error text/shape once you have an account, and tighten this
      // (e.g. to an instanceof check) if it exposes one.
      if (err instanceof Error && /already exists|duplicate/i.test(err.message)) {
        message.ack();
        continue;
      }
      console.error("verify-requests: failed to create workflow instance", message.id, err);
      message.retry();
    }
  }
}
