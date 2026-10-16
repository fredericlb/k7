// pictureImport.ts — `picture import <file> [prefix]`: a cut from another editor (`.otio`, `.edl`)
// written as this project's own picture lanes, one per video track, appended on top of what is
// there. Each shot's media is found the way a conform finds it — by the path the file gives, then
// by its name in `clips/` — and a clip already on that file is reused. What cannot be found is
// still placed, and named. See packages/song-video/docs/interchange.md.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  createVideoTrackFile,
  loadProjectRoot,
  readYamlEntities,
} from "@studio/song/loader";
import type { RawClip } from "@studio/song/rawDoc";
import { setFileValue } from "@studio/song/yaml/edit";
import { entityFileFor } from "@studio/song/yaml/moduleIO";
import { wsExists, wsWrite } from "@studio/song/yaml/workspaceFile";
import { fromEdl } from "@studio/song-video/interchange/fromEdl";
import { fromOtio } from "@studio/song-video/interchange/fromOtio";
import type { ImportedShot } from "@studio/song-video/interchange/imported";
import { climbsOut } from "@studio/web-protocol/paths";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

const ms = (n: number) => Math.round(n * 1000) / 1000;

/** Finds, and where it must, declares, the clip each imported shot's media is. */
class Media {
  private h: CommandHost;
  private from: string;
  private bySource = new Map<string, string>();
  private taken = new Set<string>();
  private inClips: Map<string, string>;
  missing = new Set<string>();

  constructor(h: CommandHost, importedFrom: string) {
    this.h = h;
    this.from = importedFrom;
    const clips = readYamlEntities(h.songPath, "clips").values as Record<
      string,
      RawClip
    >;
    for (const [id, c] of Object.entries(clips)) {
      this.taken.add(id);
      if (c.source) this.bySource.set(String(c.source), id);
    }
    const dir = resolve(h.songPath, "clips");
    this.inClips = new Map(
      (existsSync(dir) ? readdirSync(dir) : []).map((f) => [
        f.toLowerCase(),
        `clips/${f}`,
      ]),
    );
  }

  // The project-relative path of `media`: as the file names it, else by name in clips/, else where it should be.
  private locate(media: string): string {
    const path = decodeURI(media.replace(/^file:\/\//, ""));
    const abs = resolve(dirname(this.from), path);
    const rel = relative(this.h.songPath, abs);
    if (path && existsSync(abs) && !climbsOut(rel))
      return rel.split(sep).join("/");
    const name = basename(path);
    const hit = this.inClips.get(name.toLowerCase());
    if (hit) return hit;
    this.missing.add(name);
    return `clips/${name}`;
  }

  /** The clip id for a shot's media, declaring `clips/<id>.yaml` the first time a file is met. */
  clipFor(shot: ImportedShot): string {
    const source = this.locate(shot.media || shot.name);
    const known = this.bySource.get(source);
    if (known) return known;
    const stem = (basename(source).replace(/\.[^.]+$/, "") || "shot").replace(
      /[^A-Za-z0-9_-]+/g,
      "-",
    );
    let id = stem;
    for (let n = 2; this.taken.has(id); n++) id = `${stem}-${n}`;
    // A song with no footage yet has no clips/ folder, and this is the first clip it gets.
    mkdirSync(resolve(this.h.songPath, "clips"), { recursive: true });
    wsWrite(
      resolve(this.h.songPath, "clips", `${id}.yaml`),
      `source: ${source}\n`,
    );
    this.taken.add(id);
    this.bySource.set(source, id);
    return id;
  }
}

// One shot as a lane entry, in the lane file's own flow spelling.
const entry = (ref: string, s: ImportedShot): string => {
  const f = [`ref: ${ref}`, `start: ${ms(s.start)}`, `length: ${ms(s.length)}`];
  if (s.sourceFrom > 1e-6) f.push(`source_from: ${ms(s.sourceFrom)}`);
  if (s.speed !== undefined && s.speed !== 1) f.push(`speed: ${ms(s.speed)}`);
  if (s.fadeIn) f.push(`fade_in: ${ms(s.fadeIn)}`);
  return `  - { ${f.join(", ")} }`;
};

export const PICTURE_IMPORT_VERBS: Record<string, SidHandler> = {
  "picture.import": (a, h) => {
    const [fileArg, prefixArg] = splitWords(a);
    if (!fileArg) {
      h.refuse(["usage: picture import <file.otio|file.edl> [lane prefix]"]);
      return;
    }
    const abs = resolve(h.songPath, fileArg);
    const inside = relative(h.songPath, abs);
    if (climbsOut(inside) || !existsSync(abs)) {
      h.refuse([
        `no ${fileArg} in this project — put the file in it, then name it from the project folder`,
      ]);
      return;
    }
    const root = loadProjectRoot(h.songPath, false);
    const proj = (root.project ?? {}) as Record<string, unknown>;
    const viewport = Array.isArray(proj.viewport)
      ? proj.viewport.map(Number)
      : [];
    let cut: ReturnType<typeof fromOtio>;
    try {
      const text = readFileSync(abs, "utf8");
      if (/\.otio$/i.test(abs)) cut = fromOtio(text);
      // An EDL states no rate, so it is read at the project's, or the broadcast default.
      else if (/\.edl$/i.test(abs)) cut = fromEdl(text, viewport[2] || 25);
      else {
        h.refuse([`${fileArg}: an .otio or an .edl is what this reads`]);
        return;
      }
    } catch (e) {
      h.refuse([`${fileArg}: ${(e as Error).message}`]);
      return;
    }
    const tracks = cut.tracks.filter((t) => t.shots.length);
    if (!tracks.length) {
      h.refuse([`${fileArg} holds no picture to import`, ...cut.skipped]);
      return;
    }
    const lines: string[] = [];
    // A song with no picture yet gets a frame: a lane cannot compile without one (docs/picture.md).
    if (!(viewport[0] && viewport[1])) {
      const file = entityFileFor(h.songPath, "", "project");
      if (file) {
        h.snapshot?.(file.path);
        setFileValue(
          file.path,
          ["project", "viewport"],
          [1920, 1080, Math.round(cut.fps)],
        );
        lines.push(
          `project: viewport [1920, 1080, ${Math.round(cut.fps)}] — the cut's rate`,
        );
      }
    }
    const media = new Media(h, abs);
    const prefix = prefixArg || "import-";
    let n = 1;
    for (const track of tracks) {
      while (
        wsExists(resolve(h.songPath, "video_tracks", `${prefix}${n}.yaml`))
      )
        n++;
      const id = `${prefix}${n}`;
      try {
        createVideoTrackFile(h.songPath, id);
      } catch (e) {
        h.refuse([...lines, `picture import: ${(e as Error).message}`]);
        return;
      }
      const events = track.shots.map((s) => entry(media.clipFor(s), s));
      wsWrite(
        resolve(h.songPath, "video_tracks", `${id}.yaml`),
        `# imported from ${basename(abs)}${track.name ? `, track ${track.name}` : ""}\nevents:\n${events.join("\n")}\n`,
      );
      lines.push(
        `+ picture lane ${id}: ${track.shots.length} shot(s)${track.name ? ` from ${track.name}` : ""}`,
      );
    }
    if (media.missing.size)
      lines.push(
        `not found, placed anyway — copy into clips/: ${[...media.missing].sort().join(", ")}`,
      );
    lines.push(...cut.skipped.map((s) => `left out — ${s}`));
    h.log(lines);
    return h.reload();
  },
};
