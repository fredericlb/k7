// songTakes.ts — the versions of a song the player puts on tabs: its master first, then what
// the sidecar declares. Pure: what a version IS, and what a chain variant's render would be
// called. Whether that render exists is a question for the library. See ../docs/songPlayer.md.

import type { MediatekEntry } from "@studio/mediatek/types";

/** What the master's tab is called. Named and not numbered: it is the tab every song has, and
 *  the one the others are versions OF. */
export const ORIGINAL = "Original";

/** The two extensions a bounce can come back as — mp3 when that machine has ffmpeg, wav when it
 *  has not (see engine/chainPreview.ts's `bounce`). In order of preference. */
const RENDER_EXT = ["mp3", "wav"];

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
  kind: "master" | "file" | "chain";
  /** The audio's name INSIDE the song's folder. Null for a chain nobody has rendered — a state
   *  the pane words, not a fault. */
  file: string | null;
}

/**
 * A song's versions, in the sidecar's own order and the master always first.
 *
 * A FILE variant already names its bytes: `ref` is a file name in this folder, which is what
 * makes it a file variant at all (packages/mediatek/docs/variants.md). A CHAIN names a treatment
 * instead, so it arrives with no file — see `renderNames` for what one would be called.
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

/**
 * What a chain variant's render would be called, beside the master.
 *
 * Two names and not one: the bounce is filed under the extension it actually came back as, so a
 * machine with no ffmpeg leaves a `.wav` where a `.mp3` was asked for (SongVariants.tsx). The
 * catalogue cannot help here — a song's entry carries no file list, and the sidecar still names
 * the chain — so the player asks the library for each in turn.
 */
export function renderNames(variant: string): string[] {
  return RENDER_EXT.map((ext) => `${variant}.${ext}`);
}
