// Deezer's public API — no credentials, no OAuth (Deezer stopped issuing
// tokens), so only public playlists are reachable. Every call goes through a
// shared rate limiter: Deezer caps an IP at ~50 requests / 5 s and blocks
// abusive apps. Preview URLs are signed and expire, hence previewUrl()'s cache
// keyed on the URL's own `exp` stamp rather than a fixed TTL.

const API = "https://api.deezer.com";

export interface DeezerTrack {
  id: number;
  artist: string;
  title: string;
  cover: string;
  durationSec: number;
}

export interface DeezerPlaylistMeta {
  name: string;
  cover: string;
  trackCount: number;
}

// ─── rate limiter ───────────────────────────────────────────────────────────

const WINDOW_MS = 5_000;
const MAX_PER_WINDOW = 40; // under Deezer's ~50 so bursts never trip the quota
const MAX_CONCURRENT = 4;

let recent: number[] = []; // completed-request timestamps inside the window
let active = 0;
const waiting: (() => void)[] = [];

/** Resolve when a slot is free under both the window and concurrency caps. */
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });
}

function pump(): void {
  const now = Date.now();
  recent = recent.filter((t) => now - t < WINDOW_MS);
  while (
    waiting.length > 0 &&
    active < MAX_CONCURRENT &&
    recent.length < MAX_PER_WINDOW
  ) {
    recent.push(now);
    active++;
    waiting.shift()!();
  }
  // Nothing can start right now but work is queued — retry once the oldest
  // timestamp falls out of the window.
  if (waiting.length > 0 && active < MAX_CONCURRENT && recent.length > 0) {
    const wait = WINDOW_MS - (now - recent[0]) + 5;
    setTimeout(pump, Math.max(wait, 10));
  }
}

function release(): void {
  active--;
  pump();
}

// ─── transport ──────────────────────────────────────────────────────────────

/**
 * GET a Deezer endpoint as JSON. Deezer signals failures with HTTP 200 plus an
 * `error` object, so both shapes are folded into one thrown Error.
 */
async function deezerGet<T>(path: string): Promise<T> {
  await acquire();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } finally {
    release();
  }
  if (!res.ok)
    throw new Error(`deezer ${path}: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as T & {
    error?: { type?: string; message?: string };
  };
  if (body && typeof body === "object" && body.error) {
    const e = body.error;
    throw new Error(`deezer ${path}: ${e.type ?? "error"} ${e.message ?? ""}`);
  }
  return body;
}

interface RawTrack {
  id?: number;
  title?: string;
  title_short?: string;
  duration?: number;
  preview?: string;
  isrc?: string;
  artist?: { name?: string };
  album?: { cover_medium?: string; cover_small?: string };
}

function toTrack(r: RawTrack): DeezerTrack | null {
  const id = typeof r.id === "number" ? r.id : 0;
  if (id <= 0) return null;
  return {
    id,
    artist: r.artist?.name ?? "",
    // title_short drops the "(feat. …)" / "- Remastered" noise that makes the
    // answer impossible to type; the full title stays out of the game.
    title: r.title_short || r.title || "",
    cover: r.album?.cover_medium ?? r.album?.cover_small ?? "",
    durationSec: typeof r.duration === "number" ? r.duration : 0,
  };
}

// ─── endpoints ──────────────────────────────────────────────────────────────

export async function fetchPlaylistMeta(
  playlistId: string,
): Promise<DeezerPlaylistMeta> {
  const raw = await deezerGet<{
    title?: string;
    picture_medium?: string;
    nb_tracks?: number;
  }>(`/playlist/${encodeURIComponent(playlistId)}`);
  return {
    name: raw.title ?? "",
    cover: raw.picture_medium ?? "",
    trackCount: typeof raw.nb_tracks === "number" ? raw.nb_tracks : 0,
  };
}

/** Every track of a public playlist, following Deezer's `next` pagination. */
export async function fetchPlaylistTracks(
  playlistId: string,
): Promise<DeezerTrack[]> {
  const out: DeezerTrack[] = [];
  let index = 0;
  for (;;) {
    const page = await deezerGet<{ data?: RawTrack[]; next?: string }>(
      `/playlist/${encodeURIComponent(playlistId)}/tracks?index=${index}&limit=100`,
    );
    const rows = page.data ?? [];
    for (const r of rows) {
      const t = toTrack(r);
      if (t) out.push(t);
    }
    if (!page.next || rows.length === 0) break;
    index += rows.length;
    // Hard stop: a runaway `next` chain would hammer the API forever.
    if (out.length >= 1000) break;
  }
  return out;
}

/** Resolve an ISRC (the Spotify → Deezer bridge). null when unmatched. */
export async function trackByISRC(isrc: string): Promise<DeezerTrack | null> {
  try {
    return toTrack(
      await deezerGet<RawTrack>(`/track/isrc:${encodeURIComponent(isrc)}`),
    );
  } catch {
    return null;
  }
}

/** Fuzzy fallback when a title carries no ISRC, or the ISRC is unknown here. */
export async function searchTrack(
  artist: string,
  title: string,
): Promise<DeezerTrack | null> {
  const q = `artist:"${artist.replaceAll('"', "")}" track:"${title.replaceAll('"', "")}"`;
  try {
    const res = await deezerGet<{ data?: RawTrack[] }>(
      `/search?q=${encodeURIComponent(q)}&limit=1`,
    );
    const first = res.data?.[0];
    return first ? toTrack(first) : null;
  } catch {
    return null;
  }
}

// ─── preview URLs ───────────────────────────────────────────────────────────

interface CachedPreview {
  url: string;
  expiresAt: number;
}
const previewCache = new Map<number, CachedPreview>();
const FALLBACK_TTL_MS = 10 * 60_000;
const EXPIRY_MARGIN_MS = 60_000; // re-resolve a minute before the signature dies

/** Read the CDN signature's own expiry (`…hdnea=exp=<unix>…`) when present. */
function expiryOf(url: string): number {
  const m = url.match(/exp=(\d+)/);
  if (!m) return Date.now() + FALLBACK_TTL_MS;
  return Number(m[1]) * 1000 - EXPIRY_MARGIN_MS;
}

/**
 * A currently-valid 30 s preview URL for a Deezer track. Cached until the
 * signature is about to expire, so a whole game costs roughly one API call per
 * track rather than one per play.
 */
export async function previewUrl(trackId: number): Promise<string | null> {
  const hit = previewCache.get(trackId);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  let raw: RawTrack;
  try {
    raw = await deezerGet<RawTrack>(`/track/${trackId}`);
  } catch {
    return null;
  }
  const url = raw.preview ?? "";
  if (url === "") return null;
  previewCache.set(trackId, { url, expiresAt: expiryOf(url) });
  return url;
}

/** Test seam — the caches and limiter are module-level singletons. */
export function __resetDeezerState(): void {
  previewCache.clear();
  recent = [];
  active = 0;
  waiting.length = 0;
}
