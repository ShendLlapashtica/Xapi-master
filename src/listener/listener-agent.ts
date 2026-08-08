import { Agent } from "agents";
import { listAccounts } from "../catalog/components-repo";
import type { Env } from "../types";
import { searchRecent } from "./x-client";
import { extractRawPosts } from "./x-parse";
import { buildSearchQuery } from "./x-query";

const POLL_INTERVAL_SECONDS = 15 * 60;

export interface ListenerState {
  sinceId: string | null;
  lastPolledAt: string | null;
}

// Singleton Agent (addressed via getAgentByName(env.LISTENER_AGENT,
// "singleton") -- see src/api/router.ts's /admin/listener/start) that polls
// the whole tracked roster in one search/recent call every 15 minutes and
// pushes any post carrying a URL onto the raw-posts queue. Per BRIEF.md §2,
// it re-reads the account roster from D1 on every tick rather than caching
// it in Agent state, trading a trivial extra D1 read for not having a
// stale-roster bug when accounts are added mid-flight.
export class ListenerAgent extends Agent<Env, ListenerState> {
  initialState: ListenerState = { sinceId: null, lastPolledAt: null };

  async onStart(): Promise<void> {
    const existing = this.getSchedules({ type: "interval" });
    if (existing.length === 0) {
      await this.scheduleEvery(POLL_INTERVAL_SECONDS, "poll");
    }
  }

  async onRequest(_request: Request): Promise<Response> {
    // Being accessed at all is what bootstraps onStart() above; there's no
    // other HTTP surface this Agent needs to expose.
    return Response.json({
      sinceId: this.state.sinceId,
      lastPolledAt: this.state.lastPolledAt,
    });
  }

  // Scheduled callback (registered by onStart via scheduleEvery). Also
  // callable directly for testing/manual triggering.
  async poll(): Promise<void> {
    if (!this.env.X_BEARER_TOKEN) {
      // No X API access purchased -- this is a deliberate, permanent
      // choice (see README.md's "Known deviations from BRIEF.md"), not a
      // misconfiguration, so this stays a quiet no-op rather than an error
      // that would otherwise fire every 15 minutes forever. The schedule
      // itself is still kept running so the pipeline starts working on its
      // own the moment a token is set, with no extra bootstrap step.
      // Use POST /admin/verify-repo to feed repos in manually until then.
      return;
    }

    const accounts = await listAccounts(this.env.DB);
    if (accounts.length === 0) {
      return;
    }

    const query = buildSearchQuery(accounts.map((a) => a.handle));
    const response = await searchRecent(query, this.state.sinceId ?? undefined, {
      bearerToken: this.env.X_BEARER_TOKEN,
    });

    const candidates = extractRawPosts(response);
    for (const candidate of candidates) {
      await this.env.RAW_POSTS.send(candidate);
    }

    this.setState({
      sinceId: response.meta.newest_id ?? this.state.sinceId,
      lastPolledAt: new Date().toISOString(),
    });
  }
}
