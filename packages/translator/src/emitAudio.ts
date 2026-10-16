// emitAudio.ts — a lane's MATERIAL and its placements: the clips and sequences it plays, the audio
// they read (one file per distinct recording, keyed by content), and the lane file placing them.
// Every timing field is a #Timecode STRING, never a bare number — docs/import.md.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { materialWindow } from "@studio/song-edit/materialWindow";
import { beatsToDuration, beatsToPosition } from "@studio/song-schema/timecode";
import {
  type EmitCtx,
  tsDen,
  tsNum,
  uniquify,
  writeFile,
  yamlText,
} from "./emitNaming.js";
import type { ClipOut, TrackOut } from "./model.js";

// A bare number such as `4` parses as BARS and lands the clip at beat 12, hence the timecode strings.
function placementOf(
  p: {
    ref: string;
    start: number;
    loops: number;
    fadeIn?: number;
    fadeOut?: number;
    disabled?: boolean;
  },
  num: number,
  den: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: p.ref,
    start: beatsToPosition(p.start, num, den),
  };
  // The clip's extent is NOT written here: it belongs to the material — see docs/import.md.
  if (p.loops > 1) out.loop = p.loops;
  if (p.disabled) out.disabled = true;
  const opt = (k: string, v?: number) => {
    if (v) out[k] = beatsToDuration(v, num, den);
  }; // drop zeros
  opt("fadeIn", p.fadeIn);
  opt("fadeOut", p.fadeOut);
  return out;
}

// The window a clip/sequence declares, as two quoted POSITION timecodes; a window at the start says so by omission.
function windowFields(
  w: { from: number; to: number },
  num: number,
  den: number,
): Record<string, string> {
  return {
    ...(w.from > 0 ? { from: beatsToPosition(w.from, num, den) } : {}),
    ...(w.to > w.from ? { to: beatsToPosition(w.to, num, den) } : {}),
  };
}

/** A lane file: no `name` field, and the mute is the module's bypass rather than anything here — docs/import.md. */
export function trackText(
  t: TrackOut,
  placements: Record<string, unknown>[],
): string {
  const value: Record<string, unknown> = {};
  if (t.color) value.color = t.color;
  value.extends = "@meta/track";
  // The lane file's own key is `events:`, not `clips:`: these are placements of the material.
  value.events = placements;
  return yamlText(value, [["events"]]);
}

/** Where these bytes land, named after the file the archive called them and never after a clip; docs/import.md. */
function audioFor(ctx: EmitCtx, source: string, bytes: Uint8Array): string {
  const key = createHash("sha1").update(bytes).digest("hex");
  const held = ctx.audioRel.get(key);
  if (held) return held;
  const ext = extname(source) || ".wav";
  const stem =
    basename(source, extname(source)).replace(/[^A-Za-z0-9_.-]+/g, "_") ||
    "audio";
  let name = `${stem}${ext}`;
  for (let n = 2; ctx.takenAudio.has(name.toLowerCase()); n++)
    name = `${stem}-${n}${ext}`;
  ctx.takenAudio.add(name.toLowerCase());
  const rel = `clips/${name}`;
  ctx.audioRel.set(key, rel);
  return rel;
}

/** A MIDI clip: its notes inline in sequences/<id>.yaml, answering its placement. */
function emitSequence(
  ctx: EmitCtx,
  c: ClipOut,
  cid: string,
): Record<string, unknown> {
  const { song, outDir } = ctx;
  // Notes go inline as compact {t,d,k,v}, one per line — full fidelity, no quantised round-trip; `v` omitted at 1.
  const notes = (c.notes ?? []).map((n) => ({
    t: n.time,
    d: n.duration,
    k: n.key,
    ...(n.vel !== undefined && n.vel !== 1 ? { v: n.vel } : {}),
  }));
  const w = materialWindow(c);
  writeFile(
    join(outDir, `sequences/${cid}.yaml`),
    yamlText({ ...windowFields(w, tsNum(song), tsDen(song)), notes }, [
      ["notes"],
    ]),
  );
  ctx.sequenceFiles++;
  return placementOf(
    { ref: cid, start: c.start, loops: w.loops, disabled: c.disabled },
    tsNum(song),
    tsDen(song),
  );
}

/** An audio clip: its YAML in clips/<id>.yaml, its bytes once per recording, answering its placement. */
function emitClip(
  ctx: EmitCtx,
  c: ClipOut,
  cid: string,
): Record<string, unknown> {
  const { song, outDir } = ctx;
  const bytes = c.source ? ctx.assets[c.source] : undefined;
  const wavRel =
    bytes && c.source
      ? audioFor(ctx, c.source, bytes)
      : `clips/${cid}${extname(c.source ?? "") || ".wav"}`;
  if (bytes && !existsSync(join(outDir, wavRel)))
    writeFile(join(outDir, wavRel), bytes);
  else if (!bytes) ctx.missingAudio.push(cid);
  // A warped clip carries its stretch settings, so the engine time-stretches it as the source DAW did.
  const w = materialWindow(c);
  writeFile(
    join(outDir, `clips/${cid}.yaml`),
    yamlText(
      {
        source: wavRel,
        ...windowFields(w, tsNum(song), tsDen(song)),
        ...(c.warp
          ? {
              warp: {
                algorithm: c.warp.algorithm ?? "elastique",
                markers: c.warp.markers.map(([b, sec]) => [b, sec]),
              },
            }
          : {}),
      },
      // One marker pair per line, like every other list of small tuples here.
      c.warp ? [["warp", "markers"]] : [],
    ),
  );
  ctx.clipFiles++;
  return placementOf(
    {
      ref: cid,
      start: c.start,
      loops: w.loops,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      disabled: c.disabled,
    },
    tsNum(song),
    tsDen(song),
  );
}

/** Emit a source track's arrangement + raw material, return the placement values. */
export function emitArrangement(
  ctx: EmitCtx,
  t: TrackOut,
  slug: string,
): Record<string, unknown>[] {
  return (t.clips ?? []).map((c, i) => {
    const cid = uniquify(`${slug}_${i}`, ctx.usedClipIds);
    return c.type === "midi"
      ? emitSequence(ctx, c, cid)
      : emitClip(ctx, c, cid);
  });
}
