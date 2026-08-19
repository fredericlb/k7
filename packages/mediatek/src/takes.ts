// takes.ts — the versions of a song a surface puts on tabs: its master first, then what the
// sidecar declares. Pure, and here rather than in either app because BOTH read it now — st0's
// player draws the tabs, l8's playlist resolves a line to one. See docs/variants.md.

import type { MediatekEntry } from "./types.ts";

/** What the master's tab is called. Named and not numbered: it is the tab every song has, and
 *  the one the others are versions OF. */
export const ORIGINAL = "Original";

/**
 * One tab of the player: a version of the song, and the audio it is.
 *
 * The three kinds differ by where that audio comes from, which is why the kind is kept rather
 * than just the file name: a MASTER is the song's own recording, a FILE variant is bytes filed
 * beside it, and a CHAIN variant is a treatment — audio only once it has been rendered, which
 * is what the "Process" button under the variants list does.
 */
export interface Take {
  /** Its label, and its identity in the strip: the sidecar's key, or `ORIGINAL`. */
  name: string;
  kind: "master" | "file" | "missing";
  /** The audio's name INSIDE the song's folder. Null when the sidecar names a file the folder
   *  has not got — a state the pane words, not a fault. */
  file: string | null;
}

/**
 * A song's versions, in the sidecar's own order and the master always first.
 *
 * A variant names its bytes: `ref` is a file name in this folder, which is what makes it a
 * variant at all (packages/mediatek/docs/variants.md). One naming a file the folder has not got
 * arrives as `missing` and with no file — which is what a chain-backed variant now reads as.
 *
 * The master's own file may be absent: a folder can carry a sidecar and no audio, which the scan
 * allows on purpose. Its tab is drawn anyway, because a song whose master is missing is
 * something the pane has to be able to SAY.
 */
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

// `renderNames` stood here: the two names a chain variant's bounce could have taken beside
// the master (`.mp3`, or `.wav` on a machine with no ffmpeg). Nothing bounces any more — the
// chains that were bounced left the catalogue — so a variant is its own file or it is missing.
