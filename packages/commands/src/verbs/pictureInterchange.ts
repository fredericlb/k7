// pictureInterchange.ts — `picture interchange <otio|edl> [lane]`: the cut written for another
// editor to open, into `exports/` beside the project's other renders. OTIO carries every lane;
// an EDL carries one, the bottom lane unless one is named. The camera ORIGINALS are what it
// names, relative to the export, so a project folder copied whole relinks as it is.
// See packages/song-video/docs/interchange.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { loadProjectRoot } from "@studio/song/loader";
import { toEdl } from "@studio/song-video/interchange/edl";
import { toOtio } from "@studio/song-video/interchange/otio";
import type { VideoClipDoc } from "@studio/song-video/videoDoc";
import { loadVideoProject } from "@studio/song-video/videoProject";
import { probeVideo } from "@studio/video-prep/probe";
import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

const FORMATS = ["otio", "edl"] as const;

/** Where `picture interchange` writes, project-relative and FIXED, so the shell can fetch it without being told. */
const interchangePath = (format: string): string => `exports/cut.${format}`;

export const PICTURE_INTERCHANGE_VERBS: Record<string, SidHandler> = {
  "picture.interchange": async (a, h) => {
    const [format, laneArg] = splitWords(a);
    if (!format || !(FORMATS as readonly string[]).includes(format)) {
      h.refuse([`usage: picture interchange <${FORMATS.join("|")}> [lane]`]);
      return;
    }
    let doc: ReturnType<typeof loadVideoProject>;
    try {
      doc = loadVideoProject(h.songPath);
    } catch (e) {
      h.refuse([`picture interchange: ${(e as Error).message}`]);
      return;
    }
    if (!doc.videoTracks.length) {
      h.refuse(["this song has no picture lane to hand over"]);
      return;
    }
    // Only an open-ended LAST shot needs its source's length, so only those sources are probed.
    const lengths = new Map<string, number>();
    for (const lane of doc.videoTracks) {
      const last = lane.clips.at(-1);
      if (last?.source && last.length <= 0 && !last.still)
        try {
          const f = await probeVideo(last.source);
          if (f?.seconds) lengths.set(last.source, f.seconds);
        } catch {
          // Unprobed, the shot is left out and SAID to be — the writers' `skipped`.
        }
    }
    const naturalSeconds = (c: VideoClipDoc) => lengths.get(c.source);
    // The timeline is NAMED by the song's own name; the file is not, so that a download needs no lookup.
    const named = loadProjectRoot(h.songPath, false).project?.name;
    const name =
      (typeof named === "string" && named) ||
      basename(h.songPath).replace(/\.k7$/, "") ||
      "song";
    const rel = interchangePath(format);
    const abs = join(h.songPath, rel);
    let text: string;
    let skipped: string[];
    if (format === "otio") {
      ({ json: text, skipped } = toOtio(doc, {
        name,
        // A URL, so its separators are slashes on every OS.
        mediaUrl: (c) =>
          relative(resolve(h.songPath, "exports"), c.source)
            .split(sep)
            .join("/"),
        naturalSeconds,
      }));
    } else {
      const lane = laneArg
        ? doc.videoTracks.find((t) => t.id === laneArg)
        : doc.videoTracks[0];
      if (!lane) {
        h.refuse([
          `no picture lane '${laneArg}' — this song's are ${doc.videoTracks.map((t) => t.id).join(", ")}`,
        ]);
        return;
      }
      ({ text, skipped } = toEdl(lane, {
        title: name,
        fps: doc.fps,
        clipName: (c) => basename(c.source),
        naturalSeconds,
      }));
    }
    mkdirSync(resolve(h.songPath, "exports"), { recursive: true });
    writeFileSync(abs, text, "utf8");
    h.log([`+ ${rel}`, ...skipped.map((s) => `  left out — ${s}`)]);
    return h.reload();
  },
};
