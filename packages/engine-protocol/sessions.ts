// sessions.ts — the session identifier: which project inside one engine a message is about.
// A wire value, so it lives here: two PROCESSES have to spell it the same way or they drive
// two different projects and each sees the other's engine as empty. See docs/sessions.md
// here for the client rules, and engine/moteur/docs/protocol.md for the wire.

/**
 * The default session — what a client that has never heard of sessions drives.
 *
 * The engine reads `session` as `""` when the field is absent, so an old client and a new
 * one passing this are the same client. Do not "fix" it to a name: that would move every
 * such client to a different project on the same engine, in silence.
 */
export const DEFAULT_SESSION = "";

/**
 * The SERVICE half of a session id — the bare id for a surface with no user, and the prefix
 * `sessionFor` puts a person behind. Per-user ids landed with `sessionFor` below; this is no
 * longer the whole granularity, only the part that names which app is asking.
 *
 * `l8` is spelled once and read by two processes: the browser drives transport while
 * the file service compiles and sends the project. Give them different ids and the
 * frontend drives an empty session while the song plays in another.
 */
export const SESSIONS = {
  l8: "l8",
  st0: "st0",
} as const;

export type SessionId = string;

/**
 * One session per (service, person): `l8:fred_parapluie_org`.
 *
 * Needed the moment an engine can be CHOSEN per account, because two people can now choose
 * the same one — and on a service-wide id they would drive the same project, which is
 * exactly the collision sessions exist to end, moved up a level.
 *
 * `who` must be spelled identically by both halves of an app. l8 has two: the browser
 * drives transport, the file service compiles and sends. Both have the user's email, and
 * both slug it the same way here — which is why this takes the raw email and does the
 * slugging itself rather than trusting each caller to.
 *
 * Empty `who` gives back the bare service id, so a surface with no user (a deck on the
 * machine in front of you) is unchanged.
 */
export function sessionFor(service: string, who?: string | null): SessionId {
  if (!who) return service;
  // The same rule packages/file-service/src/slug.ts uses for a user's directory: not to
  // match it deliberately, but because an id that survives a filesystem survives a wire.
  return `${service}:${who.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * The reply types that are the MACHINE's and so carry no session — a closed set, not a
 * tendency. Everything else the engine sends about one project is stamped; `forSession`
 * below is only safe because that is true. See engine/moteur/docs/sessions.md.
 */
export const ENGINE_GLOBAL_REPLIES = [
  "plugins", // the installed catalogue, answered from a scan thread with no session in scope
  "audio-devices", // one interface per process, and every session must learn a switch
  "sessions", // the one question whose answer is about the OTHER sessions
  "edit-plugins", // asked by the supervisor, which drives none; each row names its own session
  "whoami", // the identity of the process
] as const;

/**
 * The reply types that describe ONE project and must be stamped. Unstamped, every client on
 * the engine reads them: an st0 module audition made l8 flash `busy` and clear its warnings.
 */
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

/**
 * Whether a frame carrying `session` is one this client should read.
 *
 * The rule is DISAGREEMENT, not absence: a frame with no session at all passes. That is safe
 * for two reasons and neither is "most replies are global" — it is that the engine stamps
 * every one of PER_SESSION_REPLIES, so the only unstamped frames a current engine sends are
 * ENGINE_GLOBAL_REPLIES; and that an engine older than sessions stamps nothing, so requiring
 * the field would make this client silently deaf against it rather than merely unsorted.
 *
 * Which means the correctness of this one line lives in engine/moteur/server/main.cpp, in the
 * choice between its `broadcast` and `broadcastTo` verbs.
 */
export function forSession(
  frame: { session?: unknown },
  mine: SessionId,
): boolean {
  return typeof frame.session !== "string" || frame.session === mine;
}
