// pictureSoundMigrate.ts — a node project's `video_source:` lanes folded into the picture lanes they
// sound: each one's chain moves to the picture lane's `#audio`, its mute, solo and highlight follow
// as `<lane>#audio`, and its file goes. A chain project spells no port, so it keeps its lanes.
// What a reader gets wrong: a picture lane sounded by TWO lanes is left as it is — merging two strips
// is a choice no migration should make. See docs/videoSound.md and song-schema docs/formatLevel.md.

import { rmSync } from "node:fs";
import { K7Document } from "@studio/k7x/document";
import { PICTURE_SOUND_LEVEL } from "@studio/song-schema/formatLevel";
import { splitPort } from "@studio/song-schema/moduleTypes";
import { GRAPH_BASE } from "@studio/song-schema/yaml/graphSchema";
import { renameNodeInAssemblies } from "./assemblyEdit";
import { laneFileFor } from "./chainItemEdit";
import { isChainProject } from "./chainProject";
import { readYamlEntities } from "./entities";
import { stampFormatLevel } from "./formatStamp";
import { forgetModuleReads } from "./moduleCache";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import type { RawClip } from "./rawDoc";
import { lanesOf, pictureLanesOf } from "./trackModule";
import { entityFileFor } from "./yaml/moduleIO";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

/** What a fold did: each sounding lane and the half it became, and what it left alone. */
export interface SoundFold {
  folded: Record<string, string>;
  warnings: string[];
}

type Data = Record<string, unknown>;
const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Fold the project at `dir`, then stamp it if a picture lane sounds on its own; null when it is a chain project. */
export function foldPictureSounds(
  dir: string,
  snapshot: (abs: string) => void = () => {},
): SoundFold | null {
  if (isChainProject(dir)) return null;
  const modules = resolveModuleMap(loadModules(dir), loadModuleRefs(dir));
  const pictures = pictureLanesOf(modules);
  const sounding = Object.entries(lanesOf(modules)).filter(
    ([, l]) => l.videoSource && l.videoSource in pictures,
  );
  const fold: SoundFold = { folded: {}, warnings: [] };
  const by = new Map<string, string[]>();
  for (const [id, l] of sounding)
    by.set(String(l.videoSource), [
      ...(by.get(String(l.videoSource)) ?? []),
      id,
    ]);
  for (const [picture, lanes] of by) {
    if (lanes.length > 1) {
      fold.warnings.push(
        `${picture}: ${lanes.join(" and ")} all play its sound — left as they are, delete all but one and open again`,
      );
      continue;
    }
    fold.folded[lanes[0]] = `${picture}#audio`;
  }
  const renamed = (n: string) => fold.folded[n] ?? n;
  const writes = new Map<string, string>();
  const removes: string[] = [];

  if (Object.keys(fold.folded).length) {
    // The graph: the lane's chain leaves the picture lane's `#audio`, its bypass becomes the half's.
    const graph = entityFileFor(dir, "", GRAPH_BASE);
    if (graph) {
      const doc = new K7Document(wsText(graph.path));
      const data = doc.toJS();
      const ref = (r: unknown) => {
        const { node } = splitPort(String(r));
        return node in fold.folded ? fold.folded[node] : r;
      };
      const next: Data = { ...data };
      if (isRecord(data.modules))
        next.modules = Object.fromEntries(
          Object.entries(data.modules).map(([k, dests]) => [
            String(ref(k)),
            listOf(dests).map(ref),
          ]),
        );
      for (const key of ["bypassed", "bus_only"])
        if (Array.isArray(data[key]))
          next[key] = (data[key] as unknown[]).map((x) => renamed(String(x)));
      if (isRecord(data.positions))
        next.positions = Object.fromEntries(
          Object.entries(data.positions).filter(([k]) => !(k in fold.folded)),
        );
      doc.at([]).applyIn([], next);
      writes.set(graph.path, doc.toString());
    }
    // The root: its solo and highlight follow; its row goes, the picture lane's own being the half's.
    const rootFile = entityFileFor(dir, "", "project");
    if (rootFile) {
      const doc = new K7Document(wsText(rootFile.path));
      const data = doc.toJS();
      const r = doc.at([]);
      for (const key of ["soloed", "highlighted"])
        if (Array.isArray(data[key]))
          r.setIn(
            [key],
            (data[key] as unknown[]).map((x) => renamed(String(x))),
            {
              inline: true,
            },
          );
      if (Array.isArray(data.trackOrder))
        r.setIn(
          ["trackOrder"],
          (data.trackOrder as unknown[]).filter(
            (x) => !(String(x) in fold.folded),
          ),
          { inline: true },
        );
      writes.set(rootFile.path, doc.toString());
    }
    for (const lane of Object.keys(fold.folded)) {
      const file = laneFileFor(dir, lane);
      if (file) removes.push(file.path);
    }
  }

  for (const abs of [...writes.keys(), ...removes]) snapshot(abs);
  for (const [abs, text] of writes) wsWriteText(abs, text);
  for (const abs of removes) rmSync(abs);
  for (const [lane, half] of Object.entries(fold.folded))
    renameNodeInAssemblies(dir, lane, half);
  if (Object.keys(fold.folded).length) forgetModuleReads(dir);

  // A picture lane whose shots sound, and that no lane sounds, plays on its own — a format a level-3 build misreads.
  const clips = readYamlEntities(dir, "clips").values as Record<
    string,
    RawClip
  >;
  const stillSounded = new Set(
    sounding.flatMap(([id, l]) =>
      id in fold.folded ? [] : [String(l.videoSource)],
    ),
  );
  const onItsOwn = Object.entries(pictures).some(
    ([id, lane]) =>
      !stillSounded.has(id) &&
      lane.events.some((e) => !!clips[String(e.ref ?? "")]?.sound),
  );
  if (onItsOwn) stampFormatLevel(dir, PICTURE_SOUND_LEVEL);
  return fold;
}
