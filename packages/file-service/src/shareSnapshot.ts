// shareSnapshot.ts — a project AT a checkpoint, made into what a share holds: its files rebuilt from the history,
// compiled for an engine with no VST, the three documents a browser draws it from, and every file the engine needs.
// The one thing a reader would get wrong: nothing here reads the live project — later edits are not the share's.
// See docs/share.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type {
  ClipDoc,
  PluginDoc,
  ProjectDoc,
} from "@studio/engine-protocol/project";
import { confineTo } from "@studio/song/confine";
import { withModuleStamp } from "@studio/song/loader";
import { modelsRoot } from "@studio/song/modelCache";
import { compileWithAutoFreezes } from "@studio/song/nodeProject";
import { accountLibraryHome } from "@studio/song/sharedFolders";
import { studioHome } from "@studio/song/studioHome";
import { projectSurfaces } from "@studio/song/surfaces";
import { LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersions";
import { AUTO_RENDERS_HOME_DIR } from "@studio/song-schema/moduleTypes";
import {
  type CheckpointFiles,
  SHARE_ROOT,
  SHARE_SCHEMA,
  type ShareManifest,
} from "@studio/web-protocol";
import { isBelow, isWithin } from "@studio/web-protocol/paths";
import {
  buildGraphDoc,
  clipExtentsOf,
  trackColorsOf,
  trackMixersOf,
} from "./graphDoc.ts";
import { webProjectOf } from "./webProject.ts";

/** A share ready to upload: a folder, what it holds, and the cleanup its caller owes once the upload is done. */
export interface ShareSnapshot {
  dir: string;
  manifest: ShareManifest;
  cleanup: () => void;
}

const slash = (p: string) => p.split(sep).join("/");

/** What a project reads of its workspace besides itself: its folder, and the shared files of every folder above it. */
export function checkpointPrefixes(projectRel: string): string[] {
  const out = [projectRel, "_playlists"];
  const parts = projectRel.split("/").slice(0, -1);
  const pins = LIBRARY_PINS_FILE.replace(/\.[^.]+$/, "");
  for (let i = parts.length; i >= 0; i--) {
    const at = parts.slice(0, i).join("/");
    const p = (name: string) => (at ? `${at}/${name}` : name);
    out.push(p("_modules"), p("_presets"), p(`${pins}.yaml`), p(`${pins}.k7x`));
  }
  return [...new Set(out)];
}

/** Write the checkpoint's files under `root`, laid out as in the workspace. */
function materialize(root: string, files: CheckpointFiles): void {
  for (const [rel, text] of Object.entries(files.texts)) {
    const to = join(root, rel);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  for (const [rel, blob] of Object.entries(files.blobs)) {
    const to = join(root, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(blob.path, to);
  }
}

/** How a path field is renamed: a FILE may be copied into the share, a folder only renamed when it is the project's. */
type Visit = (path: string, kind: "file" | "dir") => string;

/** `p` with its file fields passed through `visit` — only these, and only typed ones (docs/share.md). */
function rehomePlugin(p: PluginDoc, visit: Visit): PluginDoc {
  const f = (s: string | undefined) => (s ? visit(s, "file") : s);
  return {
    ...p,
    path: f(p.path) ?? "",
    presetSave: f(p.presetSave) ?? "",
    ...(p.irFile ? { irFile: f(p.irFile) } : {}),
    ...(p.namFile ? { namFile: f(p.namFile) } : {}),
    ...(p.surgePatch ? { surgePatch: f(p.surgePatch) } : {}),
    ...(p.deckFile ? { deckFile: f(p.deckFile) } : {}),
    ...(p.faustFiles
      ? {
          faustFiles: Object.fromEntries(
            Object.entries(p.faustFiles).map(([k, v]) => [k, visit(v, "file")]),
          ),
        }
      : {}),
    ...(p.patternBanks
      ? { patternBanks: p.patternBanks.map((b) => visit(b, "dir")) }
      : {}),
    ...(p.rack
      ? { rack: p.rack.map((r) => ({ ...r, clip: visit(r.clip, "file") })) }
      : {}),
  };
}

/** `doc` with every typed path field passed through `visit` — how its paths are renamed into the share's folder. */
export function rehome(doc: ProjectDoc, visit: Visit): ProjectDoc {
  const clip = (c: ClipDoc): ClipDoc =>
    c.source ? { ...c, source: visit(c.source, "file") } : c;
  return {
    ...doc,
    recordDir: doc.recordDir ? visit(doc.recordDir, "dir") : doc.recordDir,
    masterPlugins: doc.masterPlugins.map((p) => rehomePlugin(p, visit)),
    tracks: doc.tracks.map((t) => ({
      ...t,
      clips: t.clips.map(clip),
      ...(t.frozenMaterial
        ? { frozenMaterial: t.frozenMaterial.map(clip) }
        : {}),
      plugins: t.plugins.map((p) => rehomePlugin(p, visit)),
    })),
  };
}

/** The visit a share makes: the checkpoint's copy renamed, a FILE of the account's own stores copied in, the rest left. */
export function shareVisit(src: string, dir: string): Visit {
  const home = studioHome();
  // What of the account's folder a share may carry: its library, its renders, its models — never another workspace.
  const stores = [
    accountLibraryHome(),
    join(home, AUTO_RENDERS_HOME_DIR),
    modelsRoot(),
  ];
  return (s, kind) => {
    if (isWithin(src, s)) return `${SHARE_ROOT}src/${slash(relative(src, s))}`;
    if (kind !== "file" || !isBelow(home, s)) return s;
    const from = confineTo(stores, s);
    if (!from || !existsSync(from) || !statSync(from).isFile()) return s;
    const rel = slash(relative(home, from));
    const to = join(dir, "home", rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return `${SHARE_ROOT}home/${rel}`;
  };
}

/** Every file under `dir`, relative and slash-separated, with its size. */
function listFiles(dir: string, base = dir): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(abs, base));
    else if (e.isFile())
      out.push({ path: slash(relative(base, abs)), bytes: statSync(abs).size });
  }
  return out;
}

/** Thrown when a VST track's render is missing at the checkpoint: the share would play it wrong. */
class UnfrozenShare extends Error {}

/** Build the share of the project at `projectRel` from the checkpoint's `files`. */
export function buildShareSnapshot(
  files: CheckpointFiles,
  checkpoint: { workspace: string; seq: number; name: string },
  projectRel: string,
): ShareSnapshot {
  const dir = mkdtempSync(join(tmpdir(), "k7share-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const src = join(dir, "src");
    materialize(src, files);
    const project = join(src, projectRel);
    if (!existsSync(project))
      throw new Error(`${projectRel} is not in the checkpoint`);
    const { doc, freezes } = compileWithAutoFreezes(project, { vsts: "none" });
    // A render keyed by content the checkpoint does not have: an edit landed between the renders and the checkpoint.
    const unfrozen = freezes.filter((f) => !f.ready).map((f) => f.module);
    if (unfrozen.length)
      throw new UnfrozenShare(
        `${unfrozen.join(", ")} changed while sharing and has no render yet — share again`,
      );
    const docs = withModuleStamp(project, () => ({
      "project-doc.json": webProjectOf(doc),
      "graph.json": buildGraphDoc(
        project,
        clipExtentsOf(doc),
        trackMixersOf(doc),
        freezes,
        trackColorsOf(doc),
      ),
      "surfaces.json": projectSurfaces(project),
    }));
    // The account's own files the engine reads (renders, models, its library) are copied in, since they move on.
    const engineDoc = rehome(doc, shareVisit(src, dir));
    const docNames = [...Object.keys(docs), "engine-doc.json"];
    for (const [name, value] of Object.entries(docs))
      writeFileSync(join(dir, name), JSON.stringify(value));
    writeFileSync(join(dir, "engine-doc.json"), JSON.stringify(engineDoc));
    const all = listFiles(dir).filter((f) => !docNames.includes(f.path));
    const manifest: ShareManifest = {
      schema: SHARE_SCHEMA,
      name: doc.name || projectRel.split("/").pop() || "",
      createdAt: new Date().toISOString(),
      checkpoint,
      docs: Object.keys(docs),
      engineDoc: "engine-doc.json",
      files: all,
      bytes: listFiles(dir).reduce((n, f) => n + f.bytes, 0),
    };
    return { dir, manifest, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}
