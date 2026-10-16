// engineSessions.ts — one socket per engine SESSION, all to the selected engine: dialled lazily,
// re-dialled with a short backoff, reaped when idle, and what each session was last SENT. The
// project work on top is engineLink.ts's, reached through `linkHooks`. See docs/activeProject.md.

import { relative } from "node:path";
import {
  EngineClient,
  type RecordedTake,
} from "@studio/engine-client/engineClient";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { loadPreferences } from "@studio/song/preferences";
import { backoffMs } from "@studio/web-protocol";
import { BENCH_WORKSPACE } from "./bench.ts";
import { rootDir, slugify } from "./slug.ts";
import type { Workspace } from "./workspace.ts";

/** What engineLink.ts does when a link opens, records or is first dialled — set once, at its load. */
export const linkHooks: {
  resend: (ws: Workspace, project: string) => void;
  recorded: (session: string, take: RecordedTake) => void;
  dialled: () => void;
} = { resend: () => {}, recorded: () => {}, dialled: () => {} };

/** Whether an engine is selected at all, socket open or not. */
export const hasSelectedEngine = (): boolean => selectedEngineUrl !== undefined;

/** One socket per SESSION, all to the same engine. Keyed by session id. */
export interface Link {
  client: EngineClient;
  ready: boolean;
  /** When something last asked for it, so an abandoned one can be reaped — see pruneIdleLinks. */
  lastUsed: number;
  /** Consecutive failed dials, reset by a socket that opened. Drives the reconnect backoff. */
  attempt: number;
  /** The transport, off the engine's state frames: an automatic freeze waits for it to stop. */
  playing: boolean;
  /** …and whether rolling records, which the dry run turns off for its half second (docs/engineLoad.md). */
  recordEnabled: boolean;
}
export const links = new Map<string, Link>();

/** How long a link may go untouched before it is dropped. Minutes, not seconds. */
const LINK_IDLE_MS = 5 * 60_000;

/** The reconnect backoff's ceiling HERE, deliberately not the browser's — see docs/activeProject.md. */
const LOCAL_RECONNECT_MAX_MS = 4000;
let selectedEngineUrl: string | undefined;

/** What this service last SENT to one session, keyed by session — see docs/activeProject.md. */
export interface Served {
  ws: Workspace;
  /** The project path we sent — what the ENGINE holds, which a take belongs to. */
  project: string;
  /** The reconcile throttle, per session: two of them must not starve each other. */
  lastReconcile: number;
  reconciling: boolean;
  /** Consecutive re-sends the engine did not take — a live socket can still be deaf, docs/activeProject.md. */
  resends: number;
}
export const served = new Map<string, Served>();

/** Note that `project` is what this session now holds, keeping any reconcile state in flight. */
export function noteServed(ws: Workspace, project: string): void {
  const s = served.get(sessionOf(ws));
  if (s) {
    s.ws = ws;
    s.project = project;
    return;
  }
  served.set(sessionOf(ws), {
    ws,
    project,
    lastReconcile: 0,
    reconciling: false,
    resends: 0,
  });
}

/** Whose workspaces this machine holds. One root means one person — docs/activeProject.md. */
let owner = "";

/** Told by the request that carries it; the path no longer says, since the slug left the tree. */
export function noteOwner(email: string): void {
  if (email) owner = email;
}

/** Which session this machine's projects belong to — through `sessionFor`, so the browser's half cannot differ. */
export function sessionOf(ws: { root: string } | null): string {
  if (!ws || !owner) return SESSIONS.k7;
  const rel = relative(rootDir(), ws.root);
  // Outside the root is a workspace this service does not own — the bare session, as before.
  if (!rel || rel.startsWith("..")) return SESSIONS.k7;
  // The bench's workspace plays in a session of its own, beside the song — apps/k7/backend/docs/media/banc.md.
  if (rel.split(/[\\/]/)[0] === BENCH_WORKSPACE)
    return sessionFor(SESSIONS.bench, owner);
  return sessionFor(SESSIONS.k7, owner);
}

/** The note above read from outside, in ADDRESSES rather than paths — see docs/activeProject.md. */
export function servedProject(
  userEmail: string,
): { workspace: string; path: string } | null {
  const slug = slugify(userEmail);
  const s =
    served.get(`${SESSIONS.k7}:${slug}`) ?? served.get(SESSIONS.k7) ?? null;
  if (!s) return null;
  const ws = relative(rootDir(), s.ws.root).split(/[\\/]/);
  // Anything but a single `<workspace>` is one this machine cannot name in an address.
  if (!ws[0] || ws[0].startsWith("..")) return null;
  const rel = relative(s.ws.root, s.project).replace(/\\/g, "/");
  // `.` for a lone-project workspace, which is how the surface listing spells it too.
  return { workspace: ws[0], path: rel === "" ? "." : rel };
}

function wireEngine(session: string, e: EngineClient): void {
  e.on("open", () => {
    const l = links.get(session);
    if (l) {
      l.ready = true;
      l.attempt = 0; // a socket that opened earns the next outage a fresh, short first wait
    }
    try {
      const prefs = loadPreferences();
      if (prefs.audioDevice)
        e.setAudioDevice(prefs.audioDevice.name, prefs.audioDevice.type);
      // …then how its inputs are GROUPED, and that order is load-bearing — docs/activeProject.md.
      for (const first of prefs.inputPairs) e.setInputStereo(first, true);
    } catch {
      /* no/invalid preferences — keep the system default */
    }
    // Re-send the project THIS session was serving — a fresh socket may be a fresh ENGINE.
    const s = served.get(session);
    if (s) linkHooks.resend(s.ws, s.project);
  });
  // Doubled and jittered, but capped SHORT — see docs/activeProject.md.
  e.on("close", () => {
    const l = links.get(session);
    if (l) l.ready = false;
    const step = backoffMs(l?.attempt ?? 0, LOCAL_RECONNECT_MAX_MS);
    if (l) l.attempt++;
    setTimeout(
      () => {
        if (links.get(session)?.client === e) e.connect();
      },
      step / 2 + Math.random() * (step / 2),
    );
  });
  // Not silent: with no trace of a refused dial, "off" and "wedged" look identical.
  e.on("wserror", (err: Error) =>
    console.error(`   ✗ engine socket ${session}: ${err.message}`),
  );
  // The session is carried by the SOCKET, not the frame, so it is what a take belongs to.
  e.on("recorded", (take: RecordedTake) => linkHooks.recorded(session, take));
  // Only the transport is kept: an automatic freeze swaps a track's contents, never under the playhead.
  e.on("state", (st: { playing: boolean; recordEnabled: boolean }) => {
    const l = links.get(session);
    if (!l) return;
    l.playing = st.playing;
    l.recordEnabled = st.recordEnabled;
  });
}

/** Take a link out of the map and close it, in that order — see docs/activeProject.md. */
export function dropLink(session: string, { tellEngine = false } = {}): void {
  const l = links.get(session);
  if (!l) return;
  links.delete(session);
  try {
    if (tellEngine) l.client.dropSession(session);
    l.client.close();
  } catch {
    /* already closed */
  }
}

/** Close links nothing has used for LINK_IDLE_MS — see docs/activeProject.md. `now` is for the test. */
export function pruneIdleLinks(now: number = Date.now()): string[] {
  const dropped: string[] = [];
  for (const [session, l] of links) {
    // Never a session holding a project: it is idle between commands by nature.
    if (served.has(session)) continue;
    if (now - l.lastUsed < LINK_IDLE_MS) continue;
    dropLink(session);
    dropped.push(session);
  }
  return dropped;
}

// Dial the local engine; the sockets themselves open lazily, per session, on first use.
export function setSelectedEngine(url: string): void {
  if (url === selectedEngineUrl && links.size) return;
  selectedEngineUrl = url;
  // A different engine invalidates every session's socket, not just the current one.
  for (const session of [...links.keys()]) dropLink(session);
}

/** Drive no engine at all — a hosted file service between two bindings, packages/file-hub/docs/fileHub.md. */
export function clearSelectedEngine(): void {
  selectedEngineUrl = undefined;
  for (const session of [...links.keys()]) dropLink(session);
}

/** The socket for one session, opened on first use — the workspace is REQUIRED, docs/activeProject.md. */
export function ensureEngine(ws: Workspace | null): EngineClient | undefined {
  if (!selectedEngineUrl) return undefined;
  const session = sessionOf(ws);
  const existing = links.get(session);
  if (existing) {
    existing.lastUsed = Date.now(); // every use, so pruneIdleLinks only ever sees the abandoned
    return existing.client;
  }
  // The other half of k7's session, and deliberately NOT a driver — see docs/activeProject.md.
  const client = new EngineClient(selectedEngineUrl, session);
  links.set(session, {
    client,
    ready: false,
    lastUsed: Date.now(),
    attempt: 0,
    playing: false,
    recordEnabled: false,
  });
  wireEngine(session, client);
  client.connect();
  linkHooks.dialled();
  return client;
}

/** Whether this session's socket is open. A fresh one is not, and says so. */
export function isReady(ws: Workspace | null): boolean {
  return links.get(sessionOf(ws))?.ready ?? false;
}
