// project.ts — project-wide verbs: the master, markers, inserted / removed time, the
// metronome settings, the aspect, surfaces and reload. See docs/verbs.md.

import { join } from "node:path";
import { METRONOME_MIN } from "@studio/engine-protocol/build";
import { loadProjectRoot } from "@studio/song/loader";
import type { ProjectDoc } from "@studio/song/project";
import { createSurfaceFile } from "@studio/song/surfaces";
import { setFileValue, setQuotedKeyMap } from "@studio/song/yaml/edit";
import { spliceProjectTime } from "@studio/song-edit/insertTime";
import { ASPECTS, aspectSize } from "@studio/song-schema/aspect";
import {
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import {
  MASTER_MAX_DB,
  MASTER_MIN_DB,
} from "@studio/song-schema/yaml/projectSchema";
import { allSurfaceTypes } from "@studio/song-schema/yaml/surfaceRegistry";
import { isSurfaceType } from "@studio/song-schema/yaml/surfaceSchema";
import type { CommandHost, SidHandler } from "../commands.ts";
import { writeMasterVolume } from "./intrinsics.ts";
import { splitWords } from "./shared.ts";

// Rewrite the project's `markers` map with QUOTED keys — unquoted, `2:1:1` is a YAML 1.1 integer; docs/verbs.md.
function writeMarkers(songPath: string, map: Record<string, string>): void {
  setQuotedKeyMap(join(songPath, "project.yaml"), ["markers"], map);
}

// Flip the persisted metronome flag in settings.yaml, the source of truth — so the caller re-sends.
function writeMetronomeSetting(songPath: string, on: boolean): void {
  setFileValue(join(songPath, "settings.yaml"), ["metronome"], on);
}

// …and its LEVEL, kept apart from the flag so turning the click off and back on brings the level back.
function writeMetronomeLevel(songPath: string, level: number): void {
  setFileValue(join(songPath, "settings.yaml"), ["metronome_level"], level);
}

/** `project add|remove <at> <length>` — a POSITION then a DURATION; docs/verbs.md, packages/song/docs/insertTime.md. */
async function projectTimeCommand(
  a: string,
  h: CommandHost,
  mode: "insert" | "delete",
): Promise<void> {
  const verb = mode === "insert" ? "project add" : "project remove";
  const parts = splitWords(a);
  if (parts.length !== 2) {
    h.refuse([
      `usage: ${verb} <at> <length>`,
      `       (e.g. ${verb} 5:1:1 1:0 — a position, then a LENGTH)`,
    ]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let atBeats: number;
  let lenBeats: number;
  try {
    atBeats = parsePosition(parts[0], num, den);
    lenBeats = parseDuration(parts[1], num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  if (!(lenBeats > 0)) {
    h.refuse([`a length of ${parts[1]} moves nothing`]);
    return;
  }
  // Nothing may be pushed before the song's start — the same guard `events move` carries.
  if (mode === "delete" && atBeats < 0) {
    h.refuse(["can't remove time from before the song starts"]);
    return;
  }
  try {
    const r = spliceProjectTime(h.songPath, atBeats, lenBeats, mode);
    if (!r.files.length) {
      h.refuse([
        `nothing at or after ${parts[0]} to ${mode === "insert" ? "push" : "pull"} — the project is unchanged`,
      ]);
      return;
    }
    await h.reload();
    h.log([
      `${mode === "insert" ? "inserted" : "removed"} ${parts[1]} at ${parts[0]}: ` +
        `${r.moved} moved${r.removed ? `, ${r.removed} removed` : ""} across ${r.files.length} file${r.files.length === 1 ? "" : "s"}`,
    ]);
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

export const PROJECT_VERBS: Record<string, SidHandler> = {
  "project.time.add": (a, h) => projectTimeCommand(a, h, "insert"),
  "project.time.remove": (a, h) => projectTimeCommand(a, h, "delete"),
  /** project master <dB> — the SAME write as `node param "OUT" Volume <dB>`, kept as its own verb; docs/verbs.md. */
  "project.master": async (a, h) => {
    const raw = a.trim();
    const db = Number(raw);
    if (!raw || !Number.isFinite(db)) {
      h.refuse([
        `usage: project master <dB>  (0 is unity, ${MASTER_MIN_DB}..+${MASTER_MAX_DB})`,
      ]);
      return;
    }
    if (!(await writeMasterVolume(h, db))) return;
    h.log([
      db === 0
        ? "master at unity (0 dB) — the line is removed, which is what unity means"
        : `master ${db > 0 ? "+" : ""}${db} dB`,
    ]);
  },
  // Add or move a named marker, stored under a CANONICAL timecode so `5` and `5:1:1` are the same marker.
  "project.marker.create": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    const tcRaw = sp === -1 ? "" : trimmed.slice(0, sp);
    const name = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
    if (!tcRaw || !name) {
      h.refuse([
        "usage: create marker <timecode> <name>  (e.g. create marker 5:1:1 Chorus)",
      ]);
      return;
    }
    const p = h.project();
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    let beat: number;
    try {
      beat = parsePosition(tcRaw, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    const tc = beatsToPosition(beat, num, den); // canonical key
    // Rebuild the map from the loaded set minus this spot (so a repeat renames it), kept in beat order for a tidy file.
    const all = [
      ...p.markers.filter((m) => m.tc !== tc),
      { tc, name, beat },
    ].sort((a, b) => a.beat - b.beat);
    writeMarkers(
      h.songPath,
      Object.fromEntries(all.map((m) => [m.tc, m.name])),
    );
    h.log([`marker "${name}" @ ${tc}`]);
    await h.reload();
  },
  // Remove every marker with this name — names are the handle a user knows, timecodes only the storage key.
  "project.marker.delete": async (arg, h) => {
    const name = arg.trim();
    if (!name) {
      h.refuse(["usage: project marker delete <name>"]);
      return;
    }
    const p = h.project();
    const kept = p.markers.filter((m) => m.name !== name);
    if (kept.length === p.markers.length) {
      h.refuse([`no marker named "${name}"`]);
      return;
    }
    writeMarkers(
      h.songPath,
      Object.fromEntries(kept.map((m) => [m.tc, m.name])),
    );
    h.log([`deleted marker "${name}"`]);
    await h.reload();
  },
  /** project surface new <type> [id] — declare a special view; no layout argument, docs/verbs.md. */
  "project.surface.create": async (a, h) => {
    // Spelled from the OPEN registry, so a plugin's type is in the usage like a builtin's.
    const usage = `usage: project surface new <${allSurfaceTypes().join("|")}> [id]  (e.g. project surface new turntables desk)`;
    const [type, id] = a.trim().split(/\s+/);
    // Narrowed rather than cast, so the list in the message cannot drift from the list the parser accepts.
    if (!type || !isSurfaceType(type)) {
      h.refuse([type ? `unknown surface type '${type}'` : usage, usage]);
      return;
    }
    try {
      const rel = createSurfaceFile(h.songPath, type, id || type);
      // The surface list decides the panes, so the shell has to re-read: this command's effect IS the layout.
      h.reload();
      h.log([`created ${rel}`]);
    } catch (e) {
      h.refuse([`project surface new: ${(e as Error).message}`, usage]);
    }
  },
  // Toggle the metronome: a PROJECT setting, so it rewrites settings.yaml and re-sends. The click is remembered.
  "transport.metronome": async (_a, h) => {
    const p = h.project();
    const on = !p.settings.metronome;
    const np: ProjectDoc = { ...p, settings: { ...p.settings, metronome: on } };
    try {
      writeMetronomeSetting(h.songPath, on);
      await h.applyProject(np);
      h.log([`metronome ${on ? "on" : "off"}`]);
    } catch (e) {
      h.refuse([`metronome failed: ${(e as Error).message}`]);
    }
  },
  /** `transport metronome volume <0.2..1>` — a PROJECT setting; the 0.2 floor is Tracktion's, docs/verbs.md. */
  "transport.metronomeVolume": async (a, h) => {
    const arg = a.trim();
    const v = Number(arg);
    if (!arg || !Number.isFinite(v)) {
      h.refuse(["usage: transport metronome volume <0.2..1>"]);
      return;
    }
    if (v < METRONOME_MIN || v > 1) {
      h.refuse([
        `the click's level runs ${METRONOME_MIN} to 1 — ${arg} is outside it` +
          (v < METRONOME_MIN
            ? "; to silence it use `transport metronome`, which is the switch"
            : ""),
      ]);
      return;
    }
    // Two decimals: a slider reads a pixel, and a file full of 0.6333333 is noise in a diff.
    const level = Math.round(v * 100) / 100;
    const p = h.project();
    const np: ProjectDoc = {
      ...p,
      settings: { ...p.settings, metronomeLevel: level },
    };
    try {
      writeMetronomeLevel(h.songPath, level);
      await h.applyProject(np);
      h.log([`metronome level ${level}`]);
    } catch (e) {
      h.refuse([`metronome volume failed: ${(e as Error).message}`]);
    }
  },
  /** `project aspect <ratio>` — the frame's SHAPE, written as `project.viewport`'s size — packages/song-video/docs/picture.md. */
  "project.aspect": async (a, h) => {
    const want = aspectSize(a.trim());
    if (!want) {
      h.refuse([
        `"${a.trim()}" is not a frame shape — ${ASPECTS.map((x) => x.name).join(" or ")}`,
      ]);
      return;
    }
    const file = join(h.songPath, "project.yaml");
    // The third element is the EXPORT fps: read back and kept, so a shape change never drops it.
    const now = loadProjectRoot(h.songPath).project?.viewport as
      | number[]
      | undefined;
    const fps = now && now.length > 2 ? Number(now[2]) : null;
    // RESHAPE, never resize: the long edge is kept, so 1280×720 asked for 9:16 becomes 720×1280.
    const long = now?.[0] && now?.[1] ? Math.max(now[0], now[1]) : 0;
    const [vw, vh] = !long
      ? [want.w, want.h]
      : want.w >= want.h
        ? [long, Math.round((long * want.h) / want.w)]
        : [Math.round((long * want.w) / want.h), long];
    setFileValue(
      file,
      ["project", "viewport"],
      fps && fps > 0 ? [vw, vh, fps] : [vw, vh],
    );
    h.log([`frame is ${want.name} (${vw}×${vh})`]);
    h.reload?.();
  },
  "project.reload": async (_a, h) => {
    await h.reload();
  },
};
