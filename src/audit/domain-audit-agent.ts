import { Agent } from "agents";
import { listWatchedDomains } from "../catalog/domains-repo";
import type { Env } from "../types";

// Daily, not 15-minute like ListenerAgent's live-post polling -- attack
// -surface drift (a cert nearing expiry, a DNS record changing, a
// reputation flag appearing) doesn't need that granularity, and a domain's
// own DomainAuditWorkflow run is not cheap to fire every few minutes across
// a growing watch list.
const AUDIT_TICK_INTERVAL_SECONDS = 24 * 60 * 60;

export interface DomainAuditAgentState {
  lastTickAt: string | null;
}

// Singleton Agent (addressed via getAgentByName(env.DOMAIN_AUDIT_AGENT,
// "singleton") -- see src/api/router.ts's /admin/domain-audit-agent/start),
// mirroring ListenerAgent's structure exactly: onStart re-arms a
// self-renewing schedule once, the scheduled tick re-reads its work list
// fresh from D1 every time rather than caching it in Agent state.
export class DomainAuditAgent extends Agent<Env, DomainAuditAgentState> {
  initialState: DomainAuditAgentState = { lastTickAt: null };

  async onStart(): Promise<void> {
    const existing = this.getSchedules({ type: "interval" });
    if (existing.length === 0) {
      await this.scheduleEvery(AUDIT_TICK_INTERVAL_SECONDS, "tick");
    }
  }

  async onRequest(_request: Request): Promise<Response> {
    return Response.json({ lastTickAt: this.state.lastTickAt });
  }

  // Scheduled callback (registered by onStart via scheduleEvery). Also
  // callable directly for testing/manual triggering.
  async tick(): Promise<void> {
    const watched = await listWatchedDomains(this.env.DB);

    for (const domain of watched) {
      // A domain already mid-audit (its own last run still in flight, or a
      // stuck run) is skipped rather than double-triggered -- the next
      // daily tick will pick it up once it's back to a resting state.
      if (domain.audit_status === "auditing") {
        continue;
      }
      await this.env.DOMAIN_AUDIT_WORKFLOW.create({
        id: `domain-audit-${domain.id}-${Date.now()}`,
        params: { domainId: domain.id, hostname: domain.hostname },
      });
    }

    this.setState({ lastTickAt: new Date().toISOString() });
  }
}
