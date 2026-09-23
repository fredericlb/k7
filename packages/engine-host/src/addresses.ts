// addresses.ts — the reachable addresses the supervisor advertises to the registry: the
// browser probes loopback first (Tier 1) then each LAN IPv4 (Tier 2). The machine
// fingerprint (hostname + MACs) is a coarse hint; the authoritative tier still comes from
// the browser reaching an address and matching the engine's id.

import { createHash } from "node:crypto";
import { networkInterfaces, hostname as osHostname } from "node:os";
import type { EnginePerformance } from "@studio/web-protocol/performance";

// Kept structurally in sync with the web backend's EngineAddresses (@studio/web-protocol).
export interface EngineAddresses {
  loopback: string; // always "127.0.0.1"
  lanIps: string[]; // non-internal IPv4s
  port: number; // the engine's WebSocket port
  filePort: number; // the engine-side file service's HTTP port (same host set)
}

export interface EnginePresence {
  hostname: string;
  machineFingerprint: string;
  port: number;
  addresses: EngineAddresses;
  /** This machine's rating, once measured — web-protocol/docs/performance.md. */
  performance?: EnginePerformance;
}

// Only the IPv4s a browser could usefully dial: `!internal` alone lets a link-local 169.254 address through, and nothing routes to one.

/** Interfaces that reach no browser — VPN tunnels, container bridges, WSL and Hyper-V — matched by NAME, their addresses looking ordinary. */
const PHANTOM_IFACE =
  /^(vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|docker|br-|veth|tun|tap|utun|ZeroTier|Tailscale|wg\d)/i;

function lanIPv4s(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (PHANTOM_IFACE.test(name)) continue;
    for (const ni of ifaces[name] ?? []) {
      // node <18 typed `family` as "IPv4", >=18 also allows 4 — accept both, or this silently returns [].
      const isV4 = ni.family === "IPv4" || (ni.family as unknown) === 4;
      if (!isV4 || ni.internal) continue;
      const a = ni.address;
      if (a.startsWith("169.254.")) continue; // link-local: unroutable
      if (a.startsWith("127.")) continue; // loopback is advertised separately
      if (a === "0.0.0.0") continue;
      out.push(a);
    }
  }
  return out;
}

/** A stable per-host id over the NON-INTERNAL MACs — a coarse hint the registry never deduplicates on, and stability is its only purpose. */
function machineFingerprint(host: string): string {
  const macs: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.mac && ni.mac !== "00:00:00:00:00:00" && !ni.internal)
        macs.push(ni.mac);
    }
  }
  const seed = `${host}|${[...new Set(macs)].sort().join(",")}`;
  return createHash("sha256").update(seed).digest("hex");
}

export function gatherAddresses(
  port: number,
  filePort: number,
): EnginePresence {
  const host = osHostname();
  return {
    hostname: host,
    machineFingerprint: machineFingerprint(host),
    port,
    addresses: { loopback: "127.0.0.1", lanIps: lanIPv4s(), port, filePort },
  };
}
