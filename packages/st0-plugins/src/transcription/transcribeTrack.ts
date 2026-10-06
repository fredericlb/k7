// transcribeTrack.ts — the `track transcribe` verb's behaviour, moved here from the commands
// core when transcription became a plugin. It acts through the CommandHost exactly as any core
// verb does; what the plugin adds is the DECLARATION beside it (index.ts). See docs/verbs.md.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CommandHost } from "@studio/commands/commands";
import { laneFolder } from "@studio/song/chainItemEdit";
import { createTrackFile, isVideoSource } from "@studio/song/loader";
import { setFileValue } from "@studio/song/yaml/edit";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { parse as parseYaml } from "yaml";
import { extractAudio, srtOf, transcribeAudio } from "./transcribe";

// `track transcribe <track_in> <track_out>` — whisper listens to the video the picture lane
// places, and the transcript lands as the NEW lane's `content:` (docs/verbs.md). The order of
// the acts is the failure order that matters: everything is checked and the take RUNS before a
// line is written, so a refused transcription costs no track, and a track that already existed
// gets its content REPLACED (the journal brackets the command, so Ctrl+Z has it either way).
export async function transcribeTrack(
  arg: string,
  h: CommandHost,
): Promise<void> {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    h.refuse([
      "usage: track transcribe <track_in> <track_out>  (e.g. track transcribe cam lyrics)",
    ]);
    return;
  }
  const [trackIn, trackOut] = parts;
  // <track_in> is a PICTURE lane: video_tracks/<id>.yaml, the id being the stem, so the name is
  // checked before it reaches a path (docs/picture.md).
  if (!/^[A-Za-z0-9_.-]+$/.test(trackIn)) {
    h.refuse([
      `'${trackIn}' is not a lane name — letters, digits, '.', '_' and '-' only`,
    ]);
    return;
  }
  const laneFile = join(h.songPath, "video_tracks", `${trackIn}.yaml`);
  if (!existsSync(laneFile)) {
    h.refuse([`no picture lane "${trackIn}" (video_tracks/${trackIn}.yaml)`]);
    return;
  }
  // The FIRST shot decides what is listened to: one video, timed in its own seconds. A lane that
  // cuts between sources would need the segments re-timed onto the timeline to say anything.
  const shot = listVideoPlacements(readFileSync(laneFile, "utf8")).find(
    (p) => p.ref,
  );
  if (!shot?.ref) {
    h.refuse([`'${trackIn}' places no shot — there is no video to transcribe`]);
    return;
  }
  if (/[/\\]|\.\./.test(shot.ref)) {
    h.refuse([`'${shot.ref}' is not a clip id — the stem of a file in clips/`]);
    return;
  }
  const clipFile = join(h.songPath, "clips", `${shot.ref}.yaml`);
  let source = "";
  if (existsSync(clipFile)) {
    const doc = parseYaml(readFileSync(clipFile, "utf8")) as {
      source?: unknown;
    };
    source = typeof doc.source === "string" ? doc.source : "";
  }
  if (!source) {
    h.refuse([`clip '${shot.ref}' says no source (clips/${shot.ref}.yaml)`]);
    return;
  }
  if (!isVideoSource(source)) {
    h.refuse([
      `clip '${shot.ref}' is not a video (${source}) — transcribe listens to picture, whose sound is the speech`,
    ]);
    return;
  }
  const videoPath = resolve(h.songPath, source);
  if (!existsSync(videoPath)) {
    h.refuse([`the video is not on this machine: ${source}`]);
    return;
  }
  // <track_out>: created when new, its content REPLACED when not — the one field a rerun updates.
  if (!/^[A-Za-z0-9_.-]+$/.test(trackOut)) {
    h.refuse([
      `'${trackOut}' is not a track name — letters, digits, '.', '_' and '-' only`,
    ]);
    return;
  }
  // `nodes/`, or a chain project's `tracks/` — wherever this project keeps a lane's own file.
  const nodeFile = join(h.songPath, laneFolder(h.songPath), `${trackOut}.yaml`);
  const existed = existsSync(nodeFile);
  if (!existed) {
    try {
      createTrackFile(h.songPath, trackOut);
    } catch (e) {
      h.refuse([`track transcribe: ${(e as Error).message}`]);
      return;
    }
  }
  h.log([`whisper is listening to ${source} — this can take a few minutes`]);
  const tmp = mkdtempSync(join(tmpdir(), "st0-transcribe-"));
  try {
    extractAudio(videoPath, join(tmp, "audio.wav"));
    const segments = await transcribeAudio(join(tmp, "audio.wav"), tmp);
    if (segments.length === 0) {
      h.refuse(["whisper heard no speech in this video"]);
      return;
    }
    setFileValue(nodeFile, ["content"], srtOf(segments));
    await h.reload();
    h.log([
      `${segments.length} segments into ${trackOut} (content:) — timed in the source's own seconds`,
      ...(existed
        ? ["the track already existed, so its content was replaced"]
        : []),
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
