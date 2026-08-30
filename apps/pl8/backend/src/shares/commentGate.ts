// commentGate.ts — what a public, unauthenticated POST is allowed to be. Pure: it decides, the
// route obeys, and a test needs neither a socket nor a clock. See ../../docs/comments.md.

import { MAX_AUTHOR, MAX_BODY } from "./comments.ts";

/** How many comments one address may leave per window, and how long the window is. */
export const BURST = 10;
export const WINDOW_MS = 10 * 60 * 1000;

/** What a draft comment must be to be stored, or the sentence saying why it is not. */
export function checkComment(body: unknown):
  | {
      ok: false;
      why: string;
    }
  | {
      ok: true;
      value: { author: string; body: string; at: number | null };
    } {
  const b = (body ?? {}) as { author?: unknown; body?: unknown; at?: unknown };
  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (!text) return { ok: false, why: "a comment needs some text" };
  if (text.length > MAX_BODY)
    return { ok: false, why: `a comment stops at ${MAX_BODY} characters` };
  const author = typeof b.author === "string" ? b.author.trim() : "";
  if (author.length > MAX_AUTHOR)
    return { ok: false, why: `a name stops at ${MAX_AUTHOR} characters` };
  // Absent, null and NaN are one answer — a comment about the whole song carries no timecode.
  const raw = b.at;
  const at =
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  return { ok: true, value: { author, body: text, at } };
}

/** One caller's window: when it opened, and how much has gone through it since. */
export interface Window {
  since: number;
  used: number;
}

/** A fixed window per key, rolled over when it has expired. Returns whether this one passes. */
export function allow(
  windows: Map<string, Window>,
  key: string,
  now: number,
): boolean {
  const w = windows.get(key);
  if (!w || now - w.since >= WINDOW_MS) {
    windows.set(key, { since: now, used: 1 });
    return true;
  }
  if (w.used >= BURST) return false;
  w.used++;
  return true;
}

/** Windows nobody has used since their own expiry — dropped so a long-lived process does not grow. */
export function sweep(windows: Map<string, Window>, now: number): void {
  for (const [k, w] of windows)
    if (now - w.since >= WINDOW_MS) windows.delete(k);
}
