// compile/clips.ts — one placement read into the ClipDoc the engine plays: its window, loops,
// fades and takes. What a reader gets wrong: `start`/`loop` are 1-based positions, the rest
// 0-based durations. Part of nodeProject.ts's compile — docs/nodeProject.md.

import { resolve } from "node:path";
import { placementId } from "@studio/song-schema/placementId";
import { parseDuration, startBeats } from "@studio/song-schema/timecode";
import { readClipWarp } from "@studio/song-schema/warpPoints";
import { confineTo } from "../confine";
import type { ClipDoc, EventDoc, NoteDoc } from "../project";
import type { RawClip, RawPlacement, RawSequence } from "../rawDoc";

// A placement -> a resolved ClipDoc. `start`/`loop` are 1-based positions, the rest 0-based durations.
export function placementToClip(
  dir: string,
  p: RawPlacement,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
  num: number,
  den: number,
  tempo: number,
  roots: readonly string[],
): ClipDoc {
  const ref = String(p.ref ?? "");
  // A position as the file says it: a number is seconds, a timecode musical (song-schema docs/timecode.md).
  const pos = (tc: unknown) => startBeats(tc, num, den, tempo);
  const dur = (tc: unknown) =>
    tc != null && tc !== "" ? parseDuration(String(tc), num, den) : 0;
  // A clip's window edge, always as SECONDS, and a timecode edge is a POSITION rather than a duration (docs/graphModel.md).
  const edge = (v: unknown): number | undefined => {
    if (v == null || v === "") return undefined;
    if (typeof v === "number")
      return Number.isFinite(v) && v > 0 ? v : undefined;
    const beats = pos(v);
    return beats > 0 ? (beats * 60) / tempo : undefined;
  };
  // How many times the material's window is played, back to back. Absent is one pass.
  const loops = Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1);
  // The event's own trim, clamped as the schema bounds it; 0 is unity and is sent as nothing (song-edit docs/eventGain.md).
  const gain = Math.max(-6, Math.min(6, Number(p.gain ?? 0) || 0));
  // The placement's own words, kept UNMERGED beside the resolved answer and holding only what the file said (docs/graphModel.md).
  const evWin = (v: unknown): number | string | undefined =>
    typeof v === "number" || (typeof v === "string" && v !== "")
      ? v
      : undefined;
  const event: EventDoc = {
    ...(evWin(p.from) !== undefined ? { from: evWin(p.from) } : {}),
    ...(evWin(p.to) !== undefined ? { to: evWin(p.to) } : {}),
    ...(p.fadeIn ? { fadeIn: String(p.fadeIn) } : {}),
    ...(p.fadeOut ? { fadeOut: String(p.fadeOut) } : {}),
    ...(loops > 1 ? { loop: loops } : {}),
    ...(gain ? { gain } : {}),
    ...(p.disabled ? { disabled: true } : {}),
    // `false` is the only value that says anything here, exactly as the file spells it.
    ...(p.warp === false ? { warp: false } : {}),
    // The event's takes and comp, as written: the takes view draws them, the compile below plays them (docs/takes.md).
    ...(Array.isArray(p.takes) && p.takes.length
      ? {
          takes: p.takes.map((t) => ({
            ref: String(t.ref ?? ""),
            start: String(t.start ?? ""),
          })),
        }
      : {}),
    ...(Array.isArray(p.crossfades) && p.crossfades.length
      ? {
          crossfades: p.crossfades.map((x) => ({
            at: String(x.at ?? ""),
            length: String(x.length ?? ""),
          })),
        }
      : {}),
    ...(Array.isArray(p.comp) && p.comp.length
      ? {
          comp: p.comp.map((c) => ({
            take: String(c.take ?? ""),
            from: String(c.from ?? ""),
            to: String(c.to ?? ""),
          })),
        }
      : {}),
  };
  const base: ClipDoc = {
    // The PLACEMENT's identity, not the material's — see placementId and docs/graphModel.md.
    id: placementId(ref, pos(p.start)),
    type: "audio",
    name: ref,
    source: "",
    start: pos(p.start),
    // Filled in per kind below: a placement states no extent, it is `loops` × the window.
    length: 0,
    offset: 0,
    fadeIn: dur(p.fadeIn),
    fadeOut: dur(p.fadeOut),
    loopStart: 0,
    loopEnd: 0,
    notes: [],
    // Carried, not filtered: the timeline draws a disabled event dimmed, and the ENGINE is what skips it.
    ...(p.disabled ? { disabled: true } : {}),
    ...(Object.keys(event).length ? { event } : {}),
  };
  if (clipsMap[ref]) {
    const cm = clipsMap[ref];
    // Read through `readClipWarp` because `project.mapClip` builds the same field for the UNPLACED clip.
    const { map, declined } = readClipWarp(cm.warp);
    // …unless it is declined, which the placement and the clip file may each do and which compile to one answer (docs/warp.md).
    const off = p.warp === false || declined;
    const warp = off ? undefined : map;
    // The effective window: the clip's own narrowed by the EVENT's, most restrictive edge winning (docs/graphModel.md).
    const cFrom = edge(cm.from);
    const cTo = edge(cm.to);
    const pFrom = edge(p.from);
    const pTo = edge(p.to);
    const from =
      cFrom != null || pFrom != null
        ? Math.max(cFrom ?? 0, pFrom ?? 0)
        : undefined;
    const to = cTo != null && pTo != null ? Math.min(cTo, pTo) : (cTo ?? pTo);
    // The window in beats, 0 when the file states no `to` and only the engine can measure it (docs/graphModel.md).
    const winBeats =
      to != null && to > (from ?? 0) ? ((to - (from ?? 0)) * tempo) / 60 : 0;
    return {
      ...base,
      type: "audio",
      // A source outside the project's roots plays nothing; the compile has already named it (docs/confine.md).
      source: confineTo(roots, resolve(dir, String(cm.source))) ?? "",
      ...(winBeats > 0 ? { length: winBeats * loops } : {}),
      ...(gain ? { gainDb: gain } : {}),
      ...(loops > 1 && winBeats > 0
        ? {
            // Beats into the SOURCE, like the window they come from — the in-point is applied separately.
            loopStart: ((from ?? 0) * tempo) / 60,
            loopEnd: ((to ?? 0) * tempo) / 60,
          }
        : {}),
      // The clip's own window into its file — every placement of it plays that slice (see AudioClipSchema).
      ...(from != null ? { sourceFrom: from } : {}),
      ...(to != null ? { sourceTo: to } : {}),
      ...(warp ? { warp } : {}),
      // Only when there is a map to decline: `warp: false` on an unwarped clip says nothing.
      ...(off && map ? { warpOff: true } : {}),
    };
  }
  if (seqMap[ref]) {
    // Notes are inline in the sequence's .k7x; a pad effect is carried, never resolved (docs/padEffects.md).
    const eff = (v: unknown): number | undefined => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 2 ? n : undefined;
    };
    const notes: NoteDoc[] = (
      Array.isArray(seqMap[ref].notes) ? seqMap[ref].notes : []
    ).map(
      (n: {
        t?: unknown;
        d?: unknown;
        k?: unknown;
        v?: unknown;
        repeat?: unknown;
        skip?: unknown;
      }) => ({
        time: Number(n?.t ?? 0),
        duration: Number(n?.d ?? 0),
        key: Number(n?.k ?? 0),
        vel: Number(n?.v ?? 1),
        channel: 0,
        rel: 1,
        ...(eff(n?.repeat) ? { repeat: eff(n?.repeat) } : {}),
        ...(eff(n?.skip) ? { skip: eff(n?.skip) } : {}),
      }),
    );
    // The sequence's window in beats, defaulting to the notes' extent rounded UP TO THE BAR — see docs/graphModel.md.
    const bar = (num * 4) / den;
    const extent =
      Math.ceil(
        notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0) / bar,
      ) * bar;
    // The sequence's own window first: a `to` at or before `from` falls back to the notes' extent.
    const mFrom = seqMap[ref].from != null ? pos(seqMap[ref].from) : 0;
    const mToRaw = seqMap[ref].to != null ? pos(seqMap[ref].to) : extent;
    const mTo = mToRaw > mFrom ? mToRaw : extent > mFrom ? extent : mFrom;
    // …then the EVENT's, intersected as an audio placement's is, and with no fallback (docs/graphModel.md).
    const eFrom = p.from != null ? pos(p.from) : null;
    const eTo = p.to != null ? pos(p.to) : null;
    const wFrom = Math.max(mFrom, eFrom ?? 0);
    const wTo = Math.max(wFrom, eTo != null ? Math.min(mTo, eTo) : mTo);
    const win = wTo - wFrom;
    // A written `to` off the extent cuts a tail or pads past the last hit, and either is worth a loop range.
    const statedTo =
      (seqMap[ref].to != null || eTo != null) && Math.abs(wTo - extent) > 1e-9;
    return {
      ...base,
      type: "midi",
      notes,
      length: win * loops,
      ...(win > 0 && (loops > 1 || wFrom > 0 || statedTo)
        ? { loopStart: wFrom, loopEnd: wTo }
        : {}),
    };
  }
  return base; // dangling ref — empty audio clip (engine warns on the missing source)
}
