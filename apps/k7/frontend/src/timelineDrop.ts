// timelineDrop.ts — what a drop of OS files onto the timeline resolves to BEFORE anything is
// written: each file's kind, the clip id it declares itself under, and which lane each one lands
// on. Pure, because the upload and the two verbs that follow are the only halves a test cannot
// reach — and because the naming rule is the one part a wrong answer puts on disk. See
// docs/timeline.md.

import { isAudio } from "@studio/mediatek/media";
import {
  CAPTION_SOURCE,
  IMAGE_SOURCE,
  VIDEO_SOURCE,
} from "@studio/song-schema/yaml/entitySchemas";
import { m } from "./paraglide/messages.js";

/** Audio or picture — the two kinds of material a lane holds, and the two verbs that place one. */
export type DropKind = "audio" | "video";

/** A lane a drop can land on, in the order the timeline draws them. */
export interface DropLane {
  id: string;
  kind: DropKind;
}

/** One recognised file: what it is uploaded as, what it is declared as, and which kind it is. */
export interface DroppedClip {
  /** The clip id — the file's stem, since `clips/<id>.yaml` is named by its id and nothing else. */
  id: string;
  /** The name the bytes land under in `clips/`, extension kept. */
  upload: string;
  kind: DropKind;
}

/** What `UploadProgress` draws while the bytes go up — the shape the file tree's own upload keeps. */
export interface DropUpload {
  fileName: string;
  loaded: number;
  total: number;
  done: number;
  count: number;
}

/** One drop, as the timeline resolved it: where it landed, in both spellings, and what fell there. */
export interface TimelineDropEvent {
  /** The lane under the pointer — `lanes` is every lane from the top, so the drop can walk down. */
  lane: string;
  lanes: DropLane[];
  /** A timecode for `event add`, seconds for `picture add`: the two verbs' dialects (packages/commands/docs/picture.md). */
  tc: string;
  seconds: number;
  files: File[];
}

/** What a drop will do, decided in one place so the status line reports what actually happened. */
export interface DropPlan {
  /** Every recognised file, in drop order: all of them are uploaded and declared, placed or not. */
  declare: DroppedClip[];
  /** …and where the ones that found a lane go. A subset of `declare`, keyed by clip id. */
  place: { id: string; lane: string }[];
  /** Names with no kind we can place — a `.txt` on a timeline is a miss, not a clip. */
  refused: string[];
}

// Accents folded, everything else one dash: a name a YAML key, a URL and three filesystems agree on.
const safeStem = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "clip";

/** Which kind of material a dropped file is, or null — the EXTENSION decides, exactly as it does for the compiler. */
export function droppedKind(name: string): DropKind | null {
  // Picture first: `.webm` is in both lists, and a clip whose source ends in one compiles as picture.
  // A still is picture too, and so are captions: each lands on a picture lane (song-video/docs/media.md, titles.md).
  if (
    VIDEO_SOURCE.test(name) ||
    IMAGE_SOURCE.test(name) ||
    CAPTION_SOURCE.test(name)
  )
    return "video";
  return isAudio(name) ? "audio" : null;
}

/** A dropped file as it will sit in `clips/`: its own name, reduced to what a path may hold, or null when it is neither kind. */
export function droppedClip(name: string): DroppedClip | null {
  const kind = droppedKind(name);
  if (!kind) return null;
  // A drag from a folder carries the path it sat at; only the file's own name lands in clips/.
  const base = name.split(/[\\/]+/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  const id = safeStem(stem);
  return { id, upload: `${id}${ext}`, kind };
}

/** The declaration a dropped file gets: `source:` and nothing else, the window being the whole file (apps/k7/docs/22-syntax-material.md). */
export const clipDecl = (upload: string): string => `source: clips/${upload}\n`;

/**
 * Resolve a drop: `at` names the lane under the pointer, and its kind decides which files can be
 * placed. Files of the other kind are still declared — they are in the project, wanting a lane —
 * and the ones that run out of lanes are left rather than folded onto the last, as a paste is.
 */
export function planDrop(
  names: readonly string[],
  lanes: readonly DropLane[],
  at: string,
): DropPlan {
  const declare: DroppedClip[] = [];
  const refused: string[] = [];
  const taken = new Set<string>();
  for (const n of names) {
    const c = droppedClip(n);
    if (!c) {
      refused.push(n.split(/[\\/]+/).pop() ?? n);
      continue;
    }
    // Two files of one drop that reduce to the same id (`Kick 1.wav`, `Kick-1.wav`) are two clips, not one.
    let id = c.id;
    for (let k = 2; taken.has(id); k++) id = `${c.id}-${k}`;
    taken.add(id);
    declare.push(
      id === c.id ? c : { ...c, id, upload: c.upload.replace(c.id, id) },
    );
  }
  const from = lanes.findIndex((l) => l.id === at);
  if (from < 0) return { declare, place: [], refused };
  const kind = lanes[from].kind;
  const targets = lanes.slice(from).filter((l) => l.kind === kind);
  const place = declare
    .filter((c) => c.kind === kind)
    .flatMap((c, i) => (targets[i] ? [{ id: c.id, lane: targets[i].id }] : []));
  return { declare, place, refused };
}

/**
 * What the drop WROTE, as one line — said before the placements run, since each of those is a
 * command and reports itself. Every count it could get wrong is named rather than guessed at.
 */
export function dropReport(plan: DropPlan, reused: readonly string[]): string {
  const added = plan.declare.length - reused.length;
  const left = plan.declare.length - plan.place.length;
  const parts = [
    ...(added ? [m["status.drop.added"]({ count: added })] : []),
    ...(reused.length
      ? [m["status.drop.reused"]({ count: reused.length })]
      : []),
    ...(plan.place.length
      ? [m["status.drop.placing"]({ count: plan.place.length })]
      : []),
    ...(left ? [m["status.drop.noLane"]({ count: left })] : []),
    ...(plan.refused.length
      ? [m["status.drop.refused"]({ files: plan.refused.join(", ") })]
      : []),
  ];
  return parts.join(" — ") || m["status.drop.nothing"]();
}
