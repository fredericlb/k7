// pictureSound.ts — `picture sound <lane> [track]`: the shots' SOUND onto an audio lane the engine
// plays. Each shot's clip gets its sound extracted once, beside the video, and named by `sound:`;
// then one audio lane says `video_source: <lane>` and takes its events from the shots. Run again
// it does only what is missing, which is why the timeline can run it after every drop.
// Removing a clip from that lane SILENCES its shot, as `picture silence` does: the picture stays.
// See packages/song/docs/videoSound.md.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { extractSound } from "@studio/audio-analysis/extract";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type { K7Scope } from "@studio/k7x/document";
import {
  confineTo,
  confineToProject,
  workspaceDirOf,
} from "@studio/song/confine";
import { loadGraph } from "@studio/song/graph";
import { createTrackFile, readYamlEntities } from "@studio/song/loader";
import type { RawClip, RawVideoTrack } from "@studio/song/rawDoc";
import { addTrackMixer } from "@studio/song/trackMixerFile";
import { videoSoundPieces } from "@studio/song/videoSound";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import { VIDEO_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import {
  listVideoPlacements,
  setVideoSilentAt,
  type VideoPlacement,
} from "@studio/song-schema/yaml/videoTrackFile";
import type { CommandHost, SidHandler } from "../commands.ts";
import { laneFile, layerFile, put, target } from "./picture.ts";
import { splitWords } from "./shared.ts";

/** Where a video's sound is written: beside it, under a name no clip of its own is likely to hold. */
const soundPathOf = (source: string): string =>
  source.replace(VIDEO_SOURCE, ".sound.wav");

/** What one clip came to: a line to log (or none), and whether the shot now HAS a sound. */
interface Sounded {
  line: string | null;
  heard: boolean;
}

// Give one clip its `sound:`, extracting it when the file is not there yet.
async function soundClip(
  ref: string,
  clip: RawClip | undefined,
  h: CommandHost,
  engineBin: string | null,
): Promise<Sounded> {
  const silent = (line: string): Sounded => ({ line, heard: false });
  const source = String(clip?.source ?? "");
  if (!clip || !VIDEO_SOURCE.test(source))
    return silent(`${ref}: not a video clip — nothing to hear`);
  const want = clip.sound || soundPathOf(source);
  // Both are text a clip file holds: read from the project's roots, written only in its workspace (packages/song/docs/confine.md).
  const video = confineToProject(h.songPath, source);
  const abs = confineTo(
    [h.songPath, workspaceDirOf(h.songPath)],
    resolve(h.songPath, want),
  );
  if (!video || !abs)
    return silent(`${ref}: ${!video ? source : want} is outside the project`);
  let made = "";
  if (!existsSync(abs)) {
    try {
      const facts = await extractSound(video, abs, {
        engineBin,
      });
      if (!facts)
        return silent(`${ref}: ${source} has no sound — the shot stays silent`);
      made = `${ref}: + ${want} (${(facts.frames / facts.sampleRate).toFixed(1)}s, ${facts.channels} ch)`;
    } catch (e) {
      return silent(
        `${ref}: could not extract its sound — ${(e as Error).message}`,
      );
    }
  }
  if (clip.sound === want) return { line: made || null, heard: true };
  const file = resolve(h.songPath, "clips", `${ref}.k7x`);
  h.snapshot?.(file);
  setFileValue(file, ["sound"], want);
  return { line: made || `${ref}: sound ${want}`, heard: true };
}

// The audio lane sounding `lane`: the one that already does, else a new one named `track`.
function soundLane(lane: string, track: string, h: CommandHost): string[] {
  const g = loadGraph(h.songPath);
  const already = Object.values(g.tracks).find((t) => t.videoSource === lane);
  if (already) return [`${already.name} already plays ${lane}'s sound`];
  const written = createTrackFile(h.songPath, track);
  const file = resolve(h.songPath, written[0]);
  // A fresh lane says `events: []`, and a sounding lane may state no events of its own.
  deleteFileValue(file, ["events"]);
  setFileValue(file, ["video_source"], lane);
  let strip: string[] = [];
  try {
    strip = addTrackMixer(h.songPath, track, loadGraph(h.songPath)) ?? [];
  } catch {
    // A lane with nowhere to wire a strip still plays, as `track new` says of one.
  }
  return [
    `+ track ${track} plays ${lane}'s sound (${[...written, ...strip].join(", ")})`,
  ];
}

/** The picture lane `track` plays the sound of, or null for an ordinary lane. */
export function soundingPicture(
  songPath: string,
  track: string,
): string | null {
  try {
    return loadGraph(songPath).tracks[track]?.videoSource ?? null;
  } catch {
    return null; // a song that does not load is the caller's to report
  }
}

/** A shot whose sound a removed clip was: its lane's file, its index in `events:` and its ref. */
interface SoundedShot {
  abs: string;
  rel: string;
  index: number;
  ref: string;
  start: number;
}

/** The shot whose sound starts at `atBeats` on the lane sounding `picture`, or why there is none. */
export function shotSoundingAt(
  h: CommandHost,
  picture: string,
  atBeats: number,
): SoundedShot | string {
  const found = laneFile(picture, h);
  if (!found) return `no picture lane '${picture}'`;
  const clips = readYamlEntities(h.songPath, "clips").values as Record<
    string,
    RawClip
  >;
  const lane = wsData(found.abs) as RawVideoTrack;
  // The compile's own rule, so the piece found is the one the timeline drew (packages/song/docs/videoSound.md).
  const piece = videoSoundPieces(
    h.songPath,
    lane,
    clips,
    h.project().tempo,
  ).find((p) => Math.abs(p.clip.start - atBeats) < 1e-6);
  if (!piece) return `no shot of ${picture} sounds there`;
  const shot = listVideoPlacements(found.text)[piece.shot] as VideoPlacement;
  return { ...found, index: piece.shot, ref: shot.ref, start: shot.start };
}

/** Silence every shot named, one edit per lane file; false once one was refused. */
export function silenceShots(
  h: CommandHost,
  shots: readonly SoundedShot[],
): boolean {
  const byFile = new Map<string, SoundedShot[]>();
  for (const s of shots) byFile.set(s.abs, [...(byFile.get(s.abs) ?? []), s]);
  for (const [abs, list] of byFile) {
    const mute = (doc: K7Scope) => {
      for (const s of list) setVideoSilentAt(doc, s.index, true);
    };
    if (!put({ abs, path: [] }, mute, h, "silence")) return false;
  }
  return true;
}

/** `event remove` on a sounding lane: the shot under the clip is silenced, its picture kept. */
export function silenceSoundAt(
  h: CommandHost,
  track: string,
  picture: string,
  atBeats: number,
): void | Promise<void> {
  const shot = shotSoundingAt(h, picture, atBeats);
  if (typeof shot === "string") return h.refuse([shot]);
  if (!silenceShots(h, [shot])) return;
  h.log([
    `${track}: ${shot.ref}'s sound silenced — the shot stays on ${picture} (picture silence ${picture} ${shot.start} brings it back)`,
  ]);
  return h.reload();
}

/** Why an `event…` verb may not touch a SOUNDING lane, or null: its clips are shots, and a shot is edited as one. */
export function soundingLaneRefusal(
  spec: { sid: string; args?: { name: string }[] },
  userArgs: string,
  songPath: string,
): string | null {
  const first = spec.args?.[0]?.name;
  // Removing is the one edit it takes, as silencing the shot (`event.remove`, `events.remove`).
  if (
    !spec.sid.startsWith("event") ||
    spec.sid === "event.remove" ||
    (first !== "track" && first !== "tracks")
  )
    return null;
  let tracks: ReturnType<typeof loadGraph>["tracks"];
  try {
    tracks = loadGraph(songPath).tracks;
  } catch {
    return null; // a song that does not load is the handler's to report
  }
  for (const name of (splitWords(userArgs)[0] ?? "").split(",")) {
    const picture = tracks[name]?.videoSource;
    if (picture)
      return `'${name}' plays ${picture}'s sound — edit the shot instead (picture move | length | head | split ${picture} …)`;
  }
  return null;
}

export const PICTURE_SOUND_VERBS: Record<string, SidHandler> = {
  /** `picture silence <lane> <at>` — the shot's sound is not played, or is again; its picture is untouched. */
  "picture.silence": (a, h) => {
    const t = target(a, h, "silence", "");
    if (!t) return;
    const shot = t.list[t.index] as VideoPlacement;
    if (!shot.ref) {
      h.refuse([
        `the event at ${t.at}s is an ACTIVATION — it has no sound to silence`,
      ]);
      return;
    }
    // Read back rather than assumed: a toggle has to start from what the file says right now.
    const on = !shot.silent;
    const edit = (doc: K7Scope) => setVideoSilentAt(doc, t.index, on);
    if (!put(t, edit, h, "silence")) return;
    h.log([
      `${t.rel}: ${shot.ref} at ${t.at}s ${on ? "silenced — its picture stays" : "heard again"}`,
    ]);
    return h.reload();
  },

  "picture.sound": async (a, h) => {
    const [laneArg, trackArg] = splitWords(a);
    if (!laneArg) {
      h.refuse([
        "usage: picture sound <lane> [track]  (e.g. picture sound main dialog)",
      ]);
      return;
    }
    const found = layerFile(laneArg, h, "sound");
    if (!found) return;
    const lane = found.rel.replace(/^.*\//, "").replace(/\.k7x$/, "");
    const clips = readYamlEntities(h.songPath, "clips").values as Record<
      string,
      RawClip
    >;
    const refs = [
      ...new Set(
        listVideoPlacements(found.text)
          .map((p) => p.ref)
          .filter(Boolean),
      ),
    ];
    const engineBin = findEngineBinary();
    const lines: string[] = [];
    let heard = false;
    for (const ref of refs) {
      if (!wsExists(resolve(h.songPath, "clips", `${ref}.k7x`))) {
        lines.push(`${ref}: no clips/${ref}.k7x — skipped`);
        continue;
      }
      const done = await soundClip(ref, clips[ref], h, engineBin);
      if (done.line) lines.push(done.line);
      heard ||= done.heard;
    }
    // A lane of silent shots gets no audio lane: one that plays nothing is a strip to delete by hand.
    if (!heard) {
      h.log([...lines, `nothing on ${lane} has a sound — no lane made`]);
      return h.reload();
    }
    try {
      lines.push(...soundLane(lane, trackArg || `${lane}-sound`, h));
    } catch (e) {
      h.refuse([...lines, `picture sound: ${(e as Error).message}`]);
      return;
    }
    h.log(lines);
    return h.reload();
  },
};
