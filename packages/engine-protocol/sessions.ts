// sessions.ts — the session identifier: which project inside one engine a message is about.
// A wire value, so it lives here: two PROCESSES have to spell it the same way or they drive
// two different projects and each sees the other's engine as empty. See docs/sessions.md
// here for the client rules, and engine/st0-engine/docs/protocol.md for the wire.

/** The default session; the engine reads an absent field as `""`, so do NOT give this a name — see docs/sessions.md. */
export const DEFAULT_SESSION = "";

/** The SERVICE half of a session id, spelled once because two processes read it — see docs/sessions.md. */
export const SESSIONS = {
  st0: "st0",
  pl8: "pl8",
  // st0's BENCH, a session of its own so it plays beside the person's song — see docs/sessions.md.
  bench: "banc",
} as const;

export type SessionId = string;

/** One session per (service, person); it slugs the raw email itself, and an empty `who` gives back the bare service id. See docs/sessions.md. */
export function sessionFor(service: string, who?: string | null): SessionId {
  if (!who) return service;
  // The same rule the file service uses for a user's directory: an id that survives a filesystem survives a wire.
  return `${service}:${who.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** The reply types that are the MACHINE's and so carry no session — a closed set, not a tendency. See docs/sessions.md. */
export const ENGINE_GLOBAL_REPLIES = [
  "plugins", // the installed catalogue, answered from a scan thread with no session in scope
  "audio-devices", // one interface per process, and every session must learn a switch
  "sessions", // the one question whose answer is about the OTHER sessions
  "edit-plugins", // asked by the supervisor, which drives none; each row names its own session
  "whoami", // the identity of the process
] as const;

/** The reply types that describe ONE project and must be stamped; unstamped, every client on the engine reads them. */
export const PER_SESSION_REPLIES = [
  "state",
  "session-dropped",
  "busy",
  "applied",
  "flushed",
  "error",
  "armed",
  "record-enabled",
  "plugin-params",
  "plugin-params-live",
  "presets",
  "preset-saved",
  "io-levels",
  "recorded",
  "engine-warning",
] as const;

/** Whether a frame carrying `session` is one this client should read; the rule is DISAGREEMENT, not absence — see docs/sessions.md. */
export function forSession(
  frame: { session?: unknown },
  mine: SessionId,
): boolean {
  return typeof frame.session !== "string" || frame.session === mine;
}
