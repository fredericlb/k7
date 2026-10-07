// The one-line captions of the current round item and of the one after it.

import { m } from "../paraglide/messages.js";
import type { PeekInfo } from "../remote/state";

// biome-ignore lint/suspicious/noExplicitAny: the round item arrives untyped from the server.
export function itemLabel(item: any): string {
  if (!item) return "";
  if (item.type === "category")
    return item.category?.name ?? m["remote.modes.category"]();
  if (item.type === "song") {
    const mode = item.mode ?? "";
    const song = item.song;
    if (song?.artist && song?.title) return `${song.artist} - ${song.title}`;
    if (song?.label) return song.label;
    if (mode === "free") return m["remote.modes.question"]();
    if (mode === "fusion") return m["remote.modes.fusion"]();
    if (mode === "multi") return m["remote.modes.multi"]();
    if (mode === "slow") return m["remote.modes.slow"]();
    return m["remote.modes.song"]();
  }
  return "";
}

export function peekLabel(p: PeekInfo | null): string {
  if (!p) return "";
  if (p.finished) return m["remote.modes.end"]();
  if (p.type === "category") return `CAT: ${p.categoryName ?? "?"}`;
  if (p.type === "song") {
    if (p.songArtist && p.songTitle) return `${p.songArtist} - ${p.songTitle}`;
    return m["remote.modes.song"]();
  }
  return "";
}
