// surfaces.ts — the OPTIONAL `surfaces/` folder of an k7 project, read off the disk: one file
// per special view the editor should draw. Node-side; the parser itself is browser-safe
// (yaml/surfaceFile.ts), so an app can read one out of the file service without this.
// Full rationale: docs/surfaces.md.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { printKey } from "@studio/k7x/print";
import { isDocFile } from "@studio/song-schema/docExt";
import { CAMERA_IO } from "@studio/song-schema/moduleTypes";
import {
  type ProjectSurface,
  type ProjectSurfaces,
  parseSurface,
  SURFACES_DIR,
} from "@studio/song-schema/yaml/surfaceFile";
import {
  allSurfaceTypes,
  type SurfaceTypeContribution,
  surfaceTypeOf,
} from "@studio/song-schema/yaml/surfaceRegistry";
import type { SurfaceType } from "@studio/song-schema/yaml/surfaceSchema";
import { isChainProject, readChainProject } from "./chainProject";
import { type Diagnostic, NODES_DIR } from "./loader";
import { ensureVideoRun } from "./videoOutputs";
import { entityFiles } from "./yaml/moduleIO";
import { wsData, wsText, wsWriteText } from "./yaml/workspaceDoc";

// The shapes are the WIRE's, declared beside the browser-safe parser, so the two sides cannot drift.
export type { ProjectSurface, ProjectSurfaces };

/** Every surface a project declares, in filename order; an unparseable one is reported and skipped. */
export function projectSurfaces(dir: string): ProjectSurfaces {
  const surfaces: ProjectSurface[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { id, file } of entityFiles(
    join(dir, SURFACES_DIR),
    SURFACES_DIR,
  )) {
    const rel = file.rel.replace(/^\/+/, "");
    let text: string;
    try {
      text = wsText(file.path);
    } catch (e) {
      diagnostics.push({
        file: rel,
        line: 1,
        col: 1,
        severity: "error",
        message: `surface '${id}' could not be read: ${(e as Error).message}`,
      });
      continue;
    }
    const { value, issues } = parseSurface(text);
    for (const issue of issues)
      diagnostics.push({
        file: rel,
        line: issue.line ?? 1,
        col: issue.col ?? 1,
        severity: "error",
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      });
    if (value) surfaces.push({ id, file: rel, surface: value });
  }
  return { surfaces, diagnostics };
}

/** Scaffold `surfaces/<id>.k7x`, layout DERIVED and two refusals — see docs/surfaces.md. */
export function createSurfaceFile(
  dir: string,
  type: SurfaceType,
  id: string = type,
): string {
  // Kept although the type says so: a command line hands this a string until the registry looks at it.
  const known = surfaceTypeOf(type);
  if (!known)
    throw new Error(
      `unknown surface type '${type}' — ${allSurfaceTypes().join(", ")}`,
    );
  // The filename IS the id, exactly as it is for a curve and every other flat entity folder.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid surface name '${id}' — letters, digits, '_' and '-' only`,
    );
  const layout = known.layouts[0];
  const rel = `${SURFACES_DIR}/${id}.k7x`;
  if (existsSync(join(dir, rel)))
    throw new Error(`surface '${id}' already exists (${rel})`);
  if (layout !== "view") {
    const taken = projectSurfaces(dir).surfaces.find(
      (s) => s.surface.type === type && s.surface.layout === layout,
    );
    if (taken)
      throw new Error(
        `this project already declares a ${type} surface (${taken.file}), and only one is drawn`,
      );
  }
  mkdirSync(join(dir, SURFACES_DIR), { recursive: true });
  wsWriteText(
    join(dir, rel),
    `type(${JSON.stringify(type)})\nlayout(${JSON.stringify(layout)})\n${mappingSkeleton(known)}`,
  );
  // A viewport brings the picture's two outputs with it, in the same breath — docs/videoOutputs.md.
  if (type === "viewport") ensureVideoRun(dir);
  return rel;
}

/** Every component of a type listed with a `null` and a note — not a comment, see docs/surfaces.md. */
function mappingSkeleton(known: SurfaceTypeContribution): string {
  if (!known.mappingSkeleton.length) return "";
  return `mapping({\n${known.mappingSkeleton
    .map(([id, wants]) => `  ${printKey(id)}: null, // ${wants}\n`)
    .join("")}})\n`;
}

/** Whether `dir` authors video LANES — a folder probe, kept out of song-video, docs/surfaces.md. */
export function isVideoProject(dir: string): boolean {
  return existsSync(resolve(dir, "video_tracks"));
}

/** Whether `dir` declares a LENS, which needs no lane — a camera is a plain node (docs/moduleTypes.md). */
function namesCamera(dir: string): boolean {
  // A chain project's nodes are items of its chain files, read whole rather than grepped (docs/chainFiles.md).
  if (isChainProject(dir))
    return Object.values(readChainProject(dir).nodes).some(
      (n) => (n.value as { io?: unknown }).io === CAMERA_IO,
    );
  const nodes = join(resolve(dir), NODES_DIR);
  let found: string[];
  try {
    found = readdirSync(nodes);
  } catch {
    return false; // no `nodes/` — as good as no camera
  }
  // `io: camera` is the one field that says a module is a lens — see docs/camera.md.
  return found.some((name) => {
    if (!isDocFile(name)) return false;
    try {
      return wsData(join(nodes, name)).io === CAMERA_IO;
    } catch {
      return false; // not a file, or unreadable
    }
  });
}

/** Whether this project has a PICTURE at all: lanes of it, or a lens that needs none. */
export function hasPicture(dir: string): boolean {
  return isVideoProject(dir) || namesCamera(dir);
}

/** Whether this folder holds anything the timeline would have drawn — see docs/surfaces.md. */
function hasMaterial(dir: string): boolean {
  const abs = resolve(dir);
  return (
    existsSync(join(abs, "clips")) ||
    existsSync(join(abs, "sequences")) ||
    isVideoProject(abs)
  );
}

/** The surfaces whose `mapping` names `module` — asked before a node is RENAMED, docs/surfaces.md. */
export function surfacesNaming(dir: string, module: string): string[] {
  return projectSurfaces(dir)
    .surfaces.filter(({ surface }) =>
      Object.values(surface.mapping ?? {}).some((b) => b?.module === module),
    )
    .map((s) => s.id);
}

export function surfaceIssues(dir: string): Diagnostic[] {
  const { surfaces, diagnostics } = projectSurfaces(dir);
  const declares = (type: string) =>
    surfaces.some((s) => s.surface.type === type);
  if (hasMaterial(dir) && !declares("timeline"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      // Names the COMMAND rather than the file to write — see docs/surfaces.md.
      message:
        `this project is an arrangement and declares no timeline, so nothing draws its lanes — ` +
        `run \`project surface new timeline\` (packages/song/docs/surfaces.md)`,
    });
  if (isVideoProject(dir) && !declares("viewport"))
    diagnostics.push({
      file: `${SURFACES_DIR}/`,
      line: 1,
      col: 1,
      severity: "warning",
      message:
        `this project has video lanes and declares no viewport, so nothing composites them — ` +
        `run \`project surface new viewport\` (packages/song/docs/surfaces.md)`,
    });
  return diagnostics;
}
