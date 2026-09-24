// tunnels.ts — one tunnel agent per registry this supervisor announces to, kept in step with
// the list on every heartbeat rather than hooked into each place that edits it. A server's files
// are cached per server, under `<state>/remote/<host>`. See packages/engine-tunnel/docs/tunnel.md.

import { join } from "node:path";
import { studioDir } from "@studio/engine-client/paths";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import type { EngineIdentity } from "./identity.ts";
import { line } from "./logbus.ts";

/** A folder name for a server, from its host alone: `pl8.priv.frediver.se:443` → `pl8.priv.frediver.se_443`. */
export function cacheKey(registryUrl: string): string {
  return new URL(registryUrl).host.replace(/[^A-Za-z0-9.-]/g, "_");
}

export class Tunnels {
  private readonly agents = new Map<string, TunnelAgent>();

  constructor(
    private readonly identity: () => EngineIdentity,
    private readonly enginePort: () => number,
  ) {}

  /** Start an agent for every URL that has none, stop the ones whose URL left the list. */
  sync(registryUrls: string[]): void {
    for (const [url, agent] of this.agents)
      if (!registryUrls.includes(url)) {
        agent.stop();
        this.agents.delete(url);
      }
    for (const url of registryUrls) {
      if (this.agents.has(url)) continue;
      const { id, token } = this.identity();
      const agent = new TunnelAgent({
        registryUrl: url,
        id,
        token,
        enginePort: this.enginePort(),
        cacheDir: join(studioDir(), "remote", cacheKey(url)),
        log: (m) => line("tunnel", m),
      });
      this.agents.set(url, agent);
      agent.start();
    }
  }

  stopAll(): void {
    for (const a of this.agents.values()) a.stop();
    this.agents.clear();
  }
}
