// sessions.ts — the session identifier: which project inside one engine a message is about.
// A wire value, so it lives here: two PROCESSES have to spell it the same way or they drive
// two different projects and each sees the other's engine as empty. See docs/sessions.md
// here for the client rules, and apps/moteur/docs/protocol.md for the wire.

/**
 * The default session — what a client that has never heard of sessions drives.
 *
 * The engine reads `session` as `""` when the field is absent, so an old client and a new
 * one passing this are the same client. Do not "fix" it to a name: that would move every
 * such client to a different project on the same engine, in silence.
 */
export const DEFAULT_SESSION = "";

/**
 * The session each app drives today, one per SERVICE.
 *
 * This is the granularity that closes the collision the engine was single-project for:
 * lanes, mediatek and platines pointed at one engine used to overwrite each other's
 * project. It is NOT the final granularity — two users on two workspaces still share
 * `lanes` — and per-user ids are their own step (see the plan's M5, "un moteur par
 * utilisateur et par service").
 *
 * `lanes` is spelled once and read by two processes: the browser drives transport while
 * the file service compiles and sends the project. Give them different ids and the
 * frontend drives an empty session while the song plays in another.
 */
export const SESSIONS = {
  lanes: "lanes",
  mediatek: "mediatek",
  platines: "platines",
} as const;

export type SessionId = string;

/**
 * Whether a frame carrying `session` is one this client should read.
 *
 * The rule is DISAGREEMENT, not absence: a frame with no session at all passes. Most
 * replies are engine-global (the device list, the installed-plugin catalogue), and an
 * engine older than sessions stamps nothing — rejecting those would make this client
 * silently deaf against it rather than merely unsorted.
 */
export function forSession(
  frame: { session?: unknown },
  mine: SessionId,
): boolean {
  return typeof frame.session !== "string" || frame.session === mine;
}
