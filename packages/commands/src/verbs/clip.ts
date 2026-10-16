// clip.ts — a clip's own audio: its warp markers, its onset corrections, and the offline
// chain `track process` / `clip process` run over it. See docs/verbs.md.

import {
  processWithChain,
  type Scope,
} from "@studio/audio-passes/processChain";
import { addOnset, moveOnset, removeOnset } from "@studio/song-edit/onsets";
import {
  clipFilePath,
  clipOnsets,
  clipWarpMarkers,
  setClipOnsets,
  setClipWarp,
} from "@studio/song-edit/projectEdit";
import {
  removeWarpPoint,
  seedWarp,
  setWarpPoint,
} from "@studio/song-schema/warpPoints";
import type { CommandHost, SidHandler } from "../commands.ts";

/** `clip onset add|remove|move <clip> <sec…>` — a correction to the detected onsets, in FILE seconds. */
async function onsetCommand(
  arg: string,
  h: CommandHost,
  op: "add" | "remove" | "move",
): Promise<void> {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const [clip, ...times] = parts;
  const want = op === "move" ? 2 : 1;
  const secs = times.slice(0, want).map(Number);
  if (!clip || secs.length < want || secs.some((s) => !Number.isFinite(s))) {
    h.refuse([
      op === "move"
        ? "usage: clip onset move <clip> <from-sec> <to-sec>"
        : `usage: clip onset ${op} <clip> <sec>`,
    ]);
    return;
  }
  const before = clipOnsets(h.songPath, clip);
  // The DETECTED set is not read here: the tolerance in song/onsets.ts is what matches a time to an onset.
  const after =
    op === "add"
      ? addOnset(before, secs[0])
      : op === "remove"
        ? removeOnset(before, [], secs[0])
        : moveOnset(before, [], secs[0], secs[1]);
  try {
    setClipOnsets(h.songPath, clip, after);
  } catch (e) {
    h.refuse([`clip onset ${op}: ${(e as Error).message}`]);
    return;
  }
  const n = (after.added?.length ?? 0) + (after.removed?.length ?? 0);
  h.log([
    n === 0
      ? `${clip}: onsets back to what the engine detects`
      : `${clip}: ${after.added?.length ?? 0} added, ${after.removed?.length ?? 0} removed`,
  ]);
  await h.reload();
}

async function processCommand(
  arg: string,
  h: CommandHost,
  scope: Scope,
): Promise<void> {
  // The target is ONE token and the chain is the rest, so a médiathèque path keeps its slashes unquoted.
  const [target, ...rest] = arg.trim().split(/\s+/).filter(Boolean);
  const chain = rest.join(" ");
  if (!target || !chain) {
    h.refuse([
      `usage: ${scope} process <${scope}${scope === "clip" ? "|path" : ""}> <chain>  ` +
        "(a chain of this project, or @k7-core/<path>)",
    ]);
    return;
  }
  const { lines, changed } = await processWithChain(
    h.songPath,
    h.project(),
    target,
    chain,
    scope,
    // Back up each render before it's overwritten, so the web host's journal can undo the bounce.
    (abs) => h.snapshot?.(abs),
    // …and how to run an offline step, for a chain that separates rather than treats.
    h.runColdStep,
    undefined,
    h.renderer,
  );
  h.log(lines);
  // Only when something landed: a run that wrote nothing has nothing to re-read.
  if (changed) await h.reload();
}

export const CLIP_VERBS: Record<string, SidHandler> = {
  // Bounce material through a chain and keep the result — `scope` is all that differs; docs/processChain.md.
  "track.process": (a, h) => processCommand(a, h, "track"),
  "clip.process": (a, h) => processCommand(a, h, "clip"),
  /** clip warp <clip> <sec> <beat> — pin a moment of the source to a beat; one verb places and moves, docs/verbs.md. */
  "clip.warp": async (a, h) => {
    const [clip, secStr, beatStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined || beatStr === undefined) {
      h.refuse([
        "usage: clip warp <clip> <sec> <beat>  (e.g. clip warp break 1.94 4)",
      ]);
      return;
    }
    const [sec, beat] = [secStr, beatStr].map(Number);
    if (![sec, beat].every(Number.isFinite) || sec < 0 || beat < 0) {
      h.refuse(["sec and beat must be numbers, counted from zero"]);
      return;
    }
    let markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      // Seeding needs the clip's span in BOTH units: beats from the document, seconds from the envelope.
      const doc = h.project();
      const found = doc.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clip);
      const env = await h.clipEnvelope?.(clip);
      const beats = found?.length ?? 0;
      if (!beats || !env?.seconds) {
        h.refuse([
          `${clip}: no stretch map, and no length to seed one from`,
          "a clip has to be placed on a lane, and its envelope read, before it can be warped",
        ]);
        return;
      }
      markers = seedWarp(beats, env.seconds);
    }
    try {
      const next = setWarpPoint(markers, sec, beat);
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWarp(h.songPath, clip, next);
      h.log([`${clip}: ${sec}s → beat ${beat} (${next.length} points)`]);
    } catch (e) {
      h.refuse([`clip warp: ${(e as Error).message}`]);
      return;
    }
    await h.reload();
  },
  /** clip warp remove <clip> <sec> — drop one stretch point. Never below two: see removeWarpPoint. */
  "clip.warpRemove": async (a, h) => {
    const [clip, secStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined) {
      h.refuse(["usage: clip warp remove <clip> <sec>"]);
      return;
    }
    const sec = Number(secStr);
    if (!Number.isFinite(sec)) {
      h.refuse(["sec must be a number — seconds into the source file"]);
      return;
    }
    const markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      h.refuse([`${clip}: no stretch map to remove a point from`]);
      return;
    }
    try {
      const next = removeWarpPoint(markers, sec);
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWarp(h.songPath, clip, next);
      h.log([`${clip}: dropped the point at ${sec}s (${next.length} left)`]);
    } catch (e) {
      h.refuse([`clip warp remove: ${(e as Error).message}`]);
      return;
    }
    await h.reload();
  },
  "clip.onset.add": (a, h) => onsetCommand(a, h, "add"),
  "clip.onset.remove": (a, h) => onsetCommand(a, h, "remove"),
  "clip.onset.move": (a, h) => onsetCommand(a, h, "move"),
};
