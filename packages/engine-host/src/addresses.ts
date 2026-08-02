// addresses.ts — the reachable addresses the supervisor advertises to the registry: the
// browser probes loopback first (Tier 1) then each LAN IPv4 (Tier 2). The machine
// fingerprint (hostname + MACs) is a coarse hint; the authoritative tier still comes from
// the browser reaching an address and matching the engine's id.

import { createHash } from "node:crypto";
import { networkInterfaces, hostname as osHostname } from "node:os";

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
}

/**
 * The IPv4s worth advertising: non-internal, and not an address the browser could never
 * usefully dial.
 *
 * `!ni.internal` alone is not enough. A `169.254.x.x` link-local address is what an
 * interface assigns itself when DHCP fails — Node reports it as external, but nothing
 * on the LAN routes to it, so advertising one only adds a probe the browser must wait
 * to time out before trying an address that works.
 */
function lanIPv4s(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
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

/**
 * A stable per-host id: sha256(hostname + "|" + sorted non-internal MACs).
 *
 * A coarse hint for the registry, never an identity — `web/backend/src/registry.ts`
 * keys on the engine `id` and pins its `token` on first sight, and carries this field
 * without ever deduplicating on it.
 *
 * The MAC set is the NON-INTERNAL one deliberately: a loopback adapter's zero MAC and
 * the transient MACs of VPN/container interfaces are exactly what would make this value
 * unstable, and stability is its only purpose. (The tray's deleted Rust twin hashed
 * ALL MACs, so this value changes once per existing user on upgrade. That is safe —
 * see above — and it is the one value that visibly moves.)
 */
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
