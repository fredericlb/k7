import { f } from "./api";

// Online-guest helpers paired with the backend's /auth/guest-online flow.
// Keeps the localStorage key, the lookup-for-prefill call, and the claim
// call in one place so the gate component stays presentational.
//
// Guest identity model: the browser stores a UUID under `bt_guest_id`.
// That UUID is the user identifier the backend writes into Scores.user /
// SoloProgress.user, so a returning visitor lines up with their old runs.
// The username is enforced unique server-side; this composable just
// forwards the conflict back to the gate as a discriminated error.

const STORAGE_KEY = "bt_guest_id";
// Records which sessions the current guest token has already completed.
// Used to block replays: a guest who has finished session X on this
// browser sees a "you've already played" card on a second visit instead
// of a fresh intro. Keyed by sessionId — the guest is implicitly the
// `bt_guest_id` UUID stored alongside; clearing localStorage resets the
// whole guest identity AND the play history, which is acceptable.
const PLAYED_SESSIONS_KEY = "bt_guest_played_sessions";

/** Playlist and session ids are independent counters, so they need namespacing. */
export type PlayedKind = "session" | "playlist";

const playedKey = (kind: PlayedKind, id: number): string =>
  kind === "session" ? String(id) : `${kind}:${id}`;

function readPlayedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(PLAYED_SESSIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    // Entries written before playlist mode are bare numbers.
    return new Set(
      parsed
        .filter((v) => typeof v === "number" || typeof v === "string")
        .map(String),
    );
  } catch {
    return new Set();
  }
}

function writePlayedSet(set: Set<string>): void {
  try {
    localStorage.setItem(PLAYED_SESSIONS_KEY, JSON.stringify([...set]));
  } catch {
    /* quota / private mode — silent: worst case the guest can replay,
       which matches the pre-feature behavior. */
  }
}

export function hasGuestPlayedSession(
  id: number,
  kind: PlayedKind = "session",
): boolean {
  if (!id) return false;
  return readPlayedSet().has(playedKey(kind, id));
}

export function markGuestPlayedSession(
  id: number,
  kind: PlayedKind = "session",
): void {
  if (!id) return;
  const key = playedKey(kind, id);
  const set = readPlayedSet();
  if (set.has(key)) return;
  set.add(key);
  writePlayedSet(set);
}

// clearGuestStorage wipes both the guest UUID and the played-set so that
// when a player upgrades to a real account, the next "play as guest"
// (e.g. another visitor on this browser) starts from scratch instead of
// inheriting the previous occupant's play history.
export function clearGuestStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PLAYED_SESSIONS_KEY);
  } catch {
    /* private-mode / quota — silent: nothing we can do, and the worst
       outcome is a stale flag in the next session. */
  }
}

export function readStoredGuestId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function writeStoredGuestId(id: string): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable (private mode etc.) — silent: the gate just
       won't pre-fill the next time, which is acceptable. */
  }
}

export interface GuestLookup {
  subject: string;
  username: string;
}

// Look up the username previously associated with the supplied UUID. Returns
// null when the backend doesn't know this guest (first visit, or the Grist
// row was wiped). Errors are swallowed and surface as null — pre-filling is
// a nice-to-have, not a correctness requirement.
export async function lookupGuest(
  guestId: string,
): Promise<GuestLookup | null> {
  if (!guestId) return null;
  try {
    const r = await f(
      `/api/auth/guest-lookup?id=${encodeURIComponent(guestId)}`,
      {
        credentials: "include",
      },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as GuestLookup;
    if (!data.subject || !data.username) return null;
    return data;
  } catch {
    return null;
  }
}

export type ClaimError =
  | { kind: "conflict" } // username already taken
  | { kind: "invalid" } // username failed server-side validation
  | { kind: "network"; message: string };

export interface ClaimSuccess {
  guestId: string;
  username: string;
}

// Claim (or re-claim) a guest identity. On success the backend has set the
// session cookie, so callers should refresh useAuth() and proceed. The
// caller is expected to persist `guestId` via writeStoredGuestId() — we
// don't do it here so the call site can decide whether to keep an existing
// localStorage value if the server returned the same UUID back.
export async function claimGuest(
  username: string,
  guestId: string,
): Promise<ClaimSuccess | ClaimError> {
  try {
    const r = await f("/api/auth/guest-online", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, guestId: guestId || undefined }),
    });
    if (r.status === 409) return { kind: "conflict" };
    if (r.status === 400) return { kind: "invalid" };
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { kind: "network", message: body || r.statusText };
    }
    const data = (await r.json()) as ClaimSuccess;
    if (!data.guestId || !data.username) {
      return { kind: "network", message: "bad response shape" };
    }
    return data;
  } catch (e) {
    return { kind: "network", message: (e as Error).message };
  }
}
