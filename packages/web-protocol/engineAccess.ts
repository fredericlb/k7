// engineAccess.ts — reaching an engine: the file service's headers, the assignment lease, the
// link budgets every client shares, and the engine as the browser sees it. Re-exported by types.ts.

import type { EnginePerformance } from "./performance.ts";

// ── Engine-side file service headers ─────────────────────────────────────────

// Cross-origin with no OIDC cookie, so identity, context and the gate ride as headers — see docs/machine.md.

/** The authenticated user's email — the file service slugifies it to pick the root. */
export const USER_HEADER = "x-studio-user";
/** The chosen workspace name under ~/.k7/root/<slug>/. */
export const WORKSPACE_HEADER = "x-studio-workspace";
/** The engine's token (from the whoami probe) — the file service's light LAN gate. */
export const ENGINE_TOKEN_HEADER = "x-studio-engine-token";
/** Which engine the caller drives — how a SERVER-hosted file service learns where to send the song. */
export const ENGINE_ID_HEADER = "x-studio-engine-id";
/** The file hub's secret, the ONLY gate of a server-hosted file service — packages/file-hub/docs/fileHub.md. */
export const HUB_SECRET_HEADER = "x-studio-hub-secret";
/** "1" when the file hub found the caller in the origin's admin groups; a client's own is dropped. */
export const ADMIN_HEADER = "x-studio-admin";
/** The origin the browser reached the file hub at, stamped by the hub: how a file service names its own server. */
export const ORIGIN_HEADER = "x-studio-origin";
/** Where a server that HOSTS workspaces says so; a 404 means it does not. */
export const FILE_HUB_HELLO = "/api/files-hub";

/** What that hello answers: where the files are, and the ticket that stands in for the session there. */
export interface FileHubHello {
  path: string;
  ticket: string;
  /** Whether the caller may edit what the origin's admins own — the libraries list. */
  admin: boolean;
}

// ── The engine assignment ────────────────────────────────────────────────────

// "Assigned" is a LEASE, because a closed tab can only say goodbye best-effort — see docs/machine.md.

/** How often the driving tab re-selects to keep its engine assignment alive. */
export const ENGINE_ASSIGN_RENEW_MS = 5000;

/** No renewal for this long ⇒ the assignment lapses — past a minute, since a background tab's timers fire only once a minute. */
export const ENGINE_ASSIGN_TTL_MS = 90000;

/** Where the origin's engine relay listens, under each service's `/api`: `<path>/<id>/ws`, and `<path>/<id>/rtc`. */
export const ENGINE_PROXY_PATH = "/api/engine";

// ── Reaching an engine, and staying reached ──────────────────────────────────

// One budget for both halves, the browser probing in parallel and the relay dialling in sequence — see docs/machine.md.

/** All the time anyone gets to reach an engine — the browser's probe, and the relay's dial. */
export const ENGINE_REACH_BUDGET_MS = 3000;

/** …and the most one address may eat of it, so a first dead address cannot spend the lot. */
export const ENGINE_DIAL_TIMEOUT_MS = 1500;

// ── Keeping a link honest ────────────────────────────────────────────────────

// A half-open socket never fires `close`, and the engine has no server-side ping — see docs/machine.md.

/** Nothing inbound for this long ⇒ ask `whoami`, the one verb the engine always answers. */
export const ENGINE_IDLE_PING_MS = 10000;

/** …and no answer to it within this ⇒ the socket is dead however open it claims to be. */
export const ENGINE_PONG_TIMEOUT_MS = 5000;

/** A socket still CONNECTING after this long is given up on: a half-open dial fires no `close` to retry on. */
export const ENGINE_CONNECT_DEADLINE_MS = 10000;

/** Reconnect backoff: doubles from here, jittered, and resets on a connection that opened. */
export const ENGINE_RECONNECT_MIN_MS = 1000;

/** …and never waits longer than this, so a forgotten tab stops hammering the relay. */
export const ENGINE_RECONNECT_MAX_MS = 30000;

/** The un-jittered wait before retry number `attempt` (0 first): doubling from the minimum, never past `max`. */
export function backoffMs(
  attempt: number,
  max: number = ENGINE_RECONNECT_MAX_MS,
): number {
  return Math.min(max, ENGINE_RECONNECT_MIN_MS * 2 ** attempt);
}

// The queue that covers a blink, and only a blink: unbounded, a ten-minute outage burst on reconnect.

/** Most messages held while the socket is down. Oldest go first. */
export const ENGINE_OUTBOX_MAX = 200;

/** …and none replayed after this long: a command nobody is waiting for is not worth sending. */
export const ENGINE_OUTBOX_TTL_MS = 30000;

// ── The engine registry ──────────────────────────────────────────────────────

// An engine registers these addresses; the browser measures them all (packages/engine-browser/src/probe.ts).

/** Every address a browser may try. All are probed at once; the fastest to answer is the one used. */
export interface EngineAddresses {
  loopback: string; // "127.0.0.1" — reachable only from the same machine
  lanIps: string[]; // non-internal IPv4s — reachable from the same LAN
  port: number; // the engine's WebSocket port (same on every address)
}

/** An engine as the browser sees it — the secret token is never sent to the client. */
export interface PublicEngine {
  id: string;
  hostname: string;
  addresses: EngineAddresses;
  /** How capable the machine is, as the supervisor measured it; absent from an older supervisor — docs/performance.md. */
  performance?: EnginePerformance;
  /** The library level its machine runs — docs/library-versions-plan.md; absent from an older supervisor, which runs level 1. */
  libraryLevel?: number;
  /** The engine wire's version its machine speaks — packages/engine-protocol/docs/version.md; absent from an older registry. */
  protocol?: number;
  /** Below the oldest version this server serves: its tunnel is refused, and the picker says to update k7 on that machine. */
  outdated?: boolean;
  /** The release stamp its machine was built from, `dev` for a local build. */
  build?: string;
  /** It runs without external plugins after crashing again and again — engine/k7-supervisor/docs/crashLoop.md. */
  safeMode?: boolean;
  assigned: boolean; // already selected by someone; hidden from the pick list
  /** Who holds it and what they opened — named only to that same account, anyone else sees `assigned` alone; docs/machine.md. */
  heldBy?: string;
  heldProject?: string;
  /** The ASKING account's claims on it — its bench sits beside its song, docs/claim.md; another account's are never listed. */
  heldProjects?: { holder: string; project: string }[];
  /** Its supervisor sends no tunnel secret, so nothing stops another machine taking its id — packages/engine-registry/docs/token.md. */
  legacy?: boolean;
  // This engine's heartbeat arrived from the browser's own public IP — a same-LAN hint, not authoritative.
  sameSourceIp: boolean;
  /** A short-lived pass for the relay, minted by `/engines` and not by the registry — packages/engine-registry/proxy.ts. */
  proxyTicket?: string;
  /** Its supervisor holds a tunnel, so a WebRTC offer can reach it — packages/engine-tunnel/docs/rtc.md. */
  rtc?: boolean;
  /** The server's own engine: its tunnel presented the render key — packages/engine-tunnel/docs/jobs.md. */
  server?: boolean;
  /** What the asking account is to it — packages/engine-registry/docs/ownership.md; absent from an older registry. */
  access?: EngineAccessRole;
  /** For `shared`: the account that shared it. */
  ownedBy?: string;
}

/** `owner` enrolled it, `shared` was given it, `server` is the deployment's own, `unowned` waits for its first direct open. */
export type EngineAccessRole = "owner" | "shared" | "server" | "unowned";
