import { f } from "./api";

// The UUID under `bt_guest_id` IS the identifier the backend writes into Scores.user.

const STORAGE_KEY = "bt_guest_id";
// What this guest has already finished, so a second visit shows a card instead of a fresh intro.
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
    /* quota or private mode, silently: the worst case is a guest who can replay. */
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

// Both keys, so the NEXT visitor on this browser does not inherit the previous one's history.
export function clearGuestStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PLAYED_SESSIONS_KEY);
  } catch {
    /* quota or private mode, silently: the worst case is a stale flag next session. */
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
    /* localStorage unavailable, silently: the gate simply does not pre-fill next time. */
  }
}

export interface GuestLookup {
  subject: string;
  username: string;
}

// Null for an unknown guest AND for any error: pre-filling is a nice-to-have, not correctness.
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

// The CALLER persists `guestId`, so it can keep its stored value when the server echoes it back.
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
