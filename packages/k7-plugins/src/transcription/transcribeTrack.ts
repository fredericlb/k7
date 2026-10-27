// transcribeTrack.ts — the `track transcribe` verb's behaviour, moved here from the commands
// core when transcription became a plugin. It acts through the CommandHost exactly as any core
// verb does; what the plugin adds is the DECLARATION beside it (index.ts). See docs/verbs.md.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandHost } from "@studio/commands/commands";
import { laneFolder } from "@studio/song/chainItemEdit";
import { confineToProject } from "@studio/song/confine";
import { createPictureLane } from "@studio/song/laneStrip";
import { isVideoSource } from "@studio/song/loader";
import { pictureLaneFile } from "@studio/song/pictureLanes";
import { setFileValue } from "@studio/song/yaml/edit";
import { wsData, wsEdit, wsText } from "@studio/song/yaml/workspaceDoc";
import { wsWrite } from "@studio/song/yaml/workspaceFile";
import { CAPTION_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import {
  addVideoPlacement,
  listVideoPlacements,
  removeVideoPlacementAt,
} from "@studio/song-schema/yaml/videoTrackFile";
import { extractAudio, srtOf, transcribeAudio } from "./transcribe";

// `track transcribe <track_in> <track_out>` — whisper listens to the video the picture lane
// places, and the transcript lands as SUBTITLES: `clips/<track_out>.srt`, a caption clip naming
// it, placed on the picture lane <track_out> where the shot is, so each cue shows as it is said.
// Everything is checked and the take RUNS before a line is written, so a refused transcription
// costs nothing, and a rerun replaces its own placement (the journal makes it one Ctrl+Z).
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
  // <track_in> is a PICTURE lane, a node whose id is its file's stem, so the name is checked
  // before it reaches a path (docs/picture.md).
  if (!/^[A-Za-z0-9_.-]+$/.test(trackIn)) {
    h.refuse([
      `'${trackIn}' is not a lane name — letters, digits, '.', '_' and '-' only`,
    ]);
    return;
  }
  const laneFile = pictureLaneFile(h.songPath, trackIn);
  if (!laneFile) {
    h.refuse([`no picture lane "${trackIn}" in this song`]);
    return;
  }
  // The FIRST shot decides what is listened to: one video, timed in its own seconds. A lane that
  // cuts between sources would need the segments re-timed onto the timeline to say anything.
  const shot = listVideoPlacements(wsText(laneFile.path)).find((p) => p.ref);
  if (!shot?.ref) {
    h.refuse([`'${trackIn}' places no shot — there is no video to transcribe`]);
    return;
  }
  if (/[/\\]|\.\./.test(shot.ref)) {
    h.refuse([`'${shot.ref}' is not a clip id — the stem of a file in clips/`]);
    return;
  }
  const clipFile = join(h.songPath, "clips", `${shot.ref}.k7x`);
  let source = "";
  if (existsSync(clipFile)) {
    const clip = wsData(clipFile);
    source = typeof clip.source === "string" ? clip.source : "";
  }
  if (!source) {
    h.refuse([`clip '${shot.ref}' says no source (clips/${shot.ref}.k7x)`]);
    return;
  }
  if (!isVideoSource(source)) {
    h.refuse([
      `clip '${shot.ref}' is not a video (${source}) — transcribe listens to picture, whose sound is the speech`,
    ]);
    return;
  }
  // Text a clip file holds, so it may not name a file past the project's roots (packages/song/docs/confine.md).
  const videoPath = confineToProject(h.songPath, source);
  if (!videoPath) {
    h.refuse([
      `clip '${shot.ref}' names a file outside the project: ${source}`,
    ]);
    return;
  }
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
  if (trackOut === trackIn) {
    h.refuse([
      `the subtitles need a lane of their own — '${trackIn}' holds the video`,
    ]);
    return;
  }
  // Subtitles are drawn by a PICTURE lane: an existing <track_out> that plays sound cannot take them.
  const outLane = pictureLaneFile(h.songPath, trackOut);
  const nodeFile = join(h.songPath, laneFolder(h.songPath), `${trackOut}.k7x`);
  if (!outLane && existsSync(nodeFile)) {
    h.refuse([
      `'${trackOut}' is a sound lane — subtitles are drawn on a picture lane: name a new one, or delete it first`,
    ]);
    return;
  }
  // The caption clip shares the lane's name; one already there must be a subtitle file, never a shot.
  const srtRel = `clips/${trackOut}.srt`;
  const clipOut = join(h.songPath, "clips", `${trackOut}.k7x`);
  if (existsSync(clipOut)) {
    const was = wsData(clipOut).source;
    if (typeof was !== "string" || !CAPTION_SOURCE.test(was)) {
      h.refuse([
        `clip '${trackOut}' is not a subtitle file (clips/${trackOut}.k7x) — name another lane`,
      ]);
      return;
    }
  }
  h.log([`whisper is listening to ${source} — this can take a few minutes`]);
  const tmp = mkdtempSync(join(tmpdir(), "k7-transcribe-"));
  try {
    await extractAudio(videoPath, join(tmp, "audio.wav"));
    const segments = await transcribeAudio(join(tmp, "audio.wav"), tmp);
    if (segments.length === 0) {
      h.refuse(["whisper heard no speech in this video"]);
      return;
    }
    const srtAbs = join(h.songPath, srtRel);
    for (const f of [srtAbs, clipOut, outLane?.path ?? nodeFile])
      h.snapshot?.(f);
    wsWrite(srtAbs, srtOf(segments));
    setFileValue(clipOut, ["source"], srtRel);
    if (!outLane) createPictureLane(h.songPath, trackOut);
    // Where the shot is and from where in its source, so a cue's source time lands where it is said.
    wsEdit(outLane?.path ?? nodeFile, (doc) => {
      const lane = doc.at([]);
      const mine = listVideoPlacements(lane)
        .map((p, i) => (p.ref === trackOut ? i : -1))
        .filter((i) => i >= 0);
      for (const i of mine.reverse()) removeVideoPlacementAt(lane, i);
      addVideoPlacement(lane, {
        ref: trackOut,
        start: shot.start,
        length: shot.length,
        sourceFrom: shot.sourceFrom,
      });
    });
    await h.reload();
    h.log([
      `${segments.length} subtitles into ${srtRel}, placed on picture lane ${trackOut} under ${shot.ref}`,
      ...(outLane
        ? ["the lane already existed, so its subtitles were replaced"]
        : []),
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
