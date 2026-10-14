// shareComments.ts — the vocabulary both ends of a share's comments read: how a timecode is
// written, and how the visitor's chosen name is remembered. Pure but for one localStorage key,
// so the two screens cannot disagree about either. See docs/shared.md.

import type { CommentState, ShareComment } from "@studio/web-protocol";

/** A position in the song, as the transport clock writes it — the hour only when there is one. */
export function formatAt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Newest first, and a timecode is NOT an order: a thread is read by when it was written. */
export const newestFirst = (
  comments: readonly ShareComment[],
): ShareComment[] => [...comments].sort((a, b) => b.id - a.id);

export const inState = (
  comments: readonly ShareComment[],
  state: CommentState,
): ShareComment[] => newestFirst(comments).filter((c) => c.state === state);

/** The name a visitor last signed with. A share has no accounts, so this is all there is. */
const NAME_KEY = "k7.share.author";

export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    // A browser refusing storage costs the convenience and nothing else — the field still types.
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* see above */
  }
}
