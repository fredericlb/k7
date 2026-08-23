// takes.ts — the versions of a song a surface puts on tabs: its master first, then what the
// sidecar declares. Pure, and here rather than in either app because BOTH read it now — pl8's
// player draws the tabs, st0's playlist resolves a line to one. See docs/variants.md.

import type { MediatekEntry } from "./types.ts";

/** What the master's tab is called — the tab every song has, and the one the others are versions OF. */
export const ORIGINAL = "Original";

/** One tab of the player: a version of the song, and the audio it is — see docs/variants.md. */
export interface Take {
  /** Its label, and its identity in the strip: the sidecar's key, or `ORIGINAL`. */
  name: string;
  kind: "master" | "file" | "missing";
  /** The audio's name INSIDE the song's folder, null when the sidecar names a file that is not there. */
  file: string | null;
}

/** A song's versions in the sidecar's own order, master first even when its file is absent (docs/variants.md). */
export function takesOf(entry: MediatekEntry): Take[] {
  const master = entry.meta?.master ? String(entry.meta.master) : null;
  return [
    { name: ORIGINAL, kind: "master", file: master },
    ...(entry.variants ?? []).map<Take>((v) => ({
      name: v.name,
      kind: v.kind,
      file: v.kind === "file" ? v.ref : null,
    })),
  ];
}

// `renderNames` stood here; nothing bounces any more, so a variant is its own file or it is missing.
