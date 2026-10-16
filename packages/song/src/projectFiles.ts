// projectFiles.ts — the writers that CREATE a project's files: a lane, a video lane, a sequence,
// a module, an io node, a node, a module clone. What a reader gets wrong: a lane in a chain
// project is a chain file, not a `nodes/` file. See docs/loader.md.

import { cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { instanceName } from "@studio/song-schema/instanceName";
import {
  IO_MODULES,
  isIoSource,
  MODULE_TYPES,
  moduleRefOf,
  TRACK_REF,
} from "@studio/song-schema/moduleTypes";
import { chainTaken, createChainLane, createChainNode } from "./chainCreate";
import { isChainProject } from "./chainProject";
import { engineModules, engineRef } from "./engineCatalogue";
import { loadProjectRoot } from "./entities";
import { projectModules } from "./moduleRefs";
import { loadModules, NODES_DIR } from "./moduleTree";
import type { LoadedModule } from "./rawDoc";
import { SHARED_MODULES_PATH } from "./sharedFolders";
import { setFileValue } from "./yaml/edit";
import { entityFileFor, isProjectFolder, moduleFileFor } from "./yaml/moduleIO";
import { wsExists, wsRead, wsWrite } from "./yaml/workspaceFile";

// Create a LANE's file (`nodes/`, or `tracks/` and its chain in a chain project), appending to `trackOrder` when there is one.
export function createTrackFile(dir: string, id: string): string[] {
  // The filename is the id, and the id is what a chain's key names.
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid track name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const body = [`extends: "${TRACK_REF}"`, "events: []", ""].join("\n");
  // A chain project keeps a lane in `tracks/`, played by a chain of its own (docs/chainFiles.md).
  const written = isChainProject(dir) ? createChainLane(dir, id, body) : null;
  const rel = `nodes/${id}.yaml`;
  if (!written && wsExists(join(dir, rel)))
    throw new Error(`track '${id}' already exists (${rel})`);
  // A module of that name is not in the way: the lane takes the bare name, the module keeps its ref (docs/trackModules.md).

  if (!written) {
    mkdirSync(join(dir, "nodes"), { recursive: true });
    wsWrite(join(dir, rel), body);
  }

  const root = loadProjectRoot(dir, true);
  if (Array.isArray(root.trackOrder)) {
    const projectFile = entityFileFor(dir, "", "project");
    if (projectFile)
      setFileValue(projectFile.path, ["trackOrder"], [...root.trackOrder, id]);
  }
  return written ?? [rel];
}

/** State a lane order in `project.yaml` — the song's lanes, or its picture's, which are two lists (docs/trackKind.md). */
export function setLaneOrder(
  dir: string,
  which: "trackOrder" | "layers",
  order: string[],
): string {
  const projectFile = entityFileFor(dir, "", "project");
  if (!projectFile)
    throw new Error("no project.yaml — there is nowhere to state a lane order");
  setFileValue(
    projectFile.path,
    which === "layers" ? ["project", "layers"] : ["trackOrder"],
    order,
  );
  // `rel` carries a leading slash, its "sub" being the root; a log line is a path a reader retypes.
  return projectFile.rel.replace(/^\//, "");
}

/** Create `video_tracks/<id>.yaml` AND list `<id>` in `project.layers` — two writes and ONE act (packages/song-video/docs/picture.md). */
export function createVideoTrackFile(dir: string, id: string): string[] {
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid lane name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `video_tracks/${id}.yaml`;
  if (wsExists(join(dir, rel)))
    throw new Error(`picture lane '${id}' already exists (${rel})`);
  // The graph draws a song's lanes and its picture lanes in ONE name space, so the two cannot share a name.
  if (
    wsExists(join(dir, "nodes", `${id}.yaml`)) ||
    wsExists(join(dir, "tracks", `${id}.yaml`)) ||
    id in loadModules(dir)
  )
    throw new Error(`'${id}' is already a track or a module in this project`);
  // Looked up BEFORE either write: an orphan lane file would fail the compile until somebody listed it by hand.
  const projectFile = entityFileFor(dir, "", "project");
  if (!projectFile)
    throw new Error(
      "no project.yaml — a picture lane has nowhere to be listed",
    );
  const layers = loadProjectRoot(dir, true).project?.layers;

  mkdirSync(join(dir, "video_tracks"), { recursive: true });
  // No x/y/w/h: a lane stating no rect fills the frame, which is what a new one should do (song-video/docs/picture.md).
  wsWrite(join(dir, rel), ["events: []", ""].join("\n"));
  // Appended, so the new lane draws LAST — on top, where you can see what you just made.
  setFileValue(
    projectFile.path,
    ["project", "layers"],
    [...(Array.isArray(layers) ? layers.map(String) : []), id],
  );
  // The project file's rel carries a leading slash, its "sub" being the root; the log line is a path a reader retypes.
  return [rel, projectFile.rel.replace(/^\//, "")];
}

// Create `sequences/<id>.yaml` — four empty bars said as the sequence's own window, since no notes means nothing to measure.
export function createSequenceFile(dir: string, id: string): string[] {
  if (!/^[A-Za-z0-9_.-]+$/.test(id))
    throw new Error(
      `invalid sequence name '${id}' — letters, digits, '.', '_' and '-' only`,
    );
  const rel = `sequences/${id}.yaml`;
  if (wsExists(join(dir, rel)))
    throw new Error(`sequence '${id}' already exists (${rel})`);
  mkdirSync(join(dir, "sequences"), { recursive: true });
  wsWrite(
    join(dir, rel),
    ['from: "1:1"', 'to: "5:1"', "notes: []", ""].join("\n"),
  );
  return [rel];
}

export function createModuleFile(
  dir: string,
  category: string,
  module: string,
  extendsRef?: string,
): string {
  // Only known type folders are ever scanned — refuse rather than write something inert.
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  // io has no template to scaffold ahead of its instance — the role IS the node, made by `node new` alone.
  if (category === "io")
    throw new Error(
      `an io module is made with its instance — \`node new io/<${Object.keys(IO_MODULES).join("|")}> <name>\``,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(module))
    throw new Error(
      `invalid module name '${module}' — letters, digits, '_' and '-' only`,
    );
  // Checked against the real vocabulary, not a guessed path: an inherited "@ns/…" ref has no local file to stat.
  if (extendsRef) {
    const known = projectModules(dir);
    if (!(extendsRef in known)) {
      const refs = Object.keys(known).sort();
      throw new Error(
        `unknown module '${extendsRef}'${refs.length ? ` — this project has: ${refs.join(", ")}` : " — this project has none"}`,
      );
    }
  }
  // A project writes into the workspace's library; a template edited with `at` bundles its own `modules/`.
  const isProject = isProjectFolder(dir);
  const moduleDir = isProject
    ? resolve(dir, SHARED_MODULES_PATH, category, module)
    : join(dir, "modules", category, module);
  const rel = isProject
    ? `${SHARED_MODULES_PATH}/${category}/${module}/module.yaml`
    : `modules/${category}/${module}/module.yaml`;
  if (wsExists(moduleDir))
    throw new Error(
      `${category}/${module} already exists ${isProject ? "in the workspace's _modules" : "here"}`,
    );
  mkdirSync(moduleDir, { recursive: true });
  const body = extendsRef // a flat mapping, no `name:` — the folder names it
    ? `# ${module}: extends module "${extendsRef}".\n` +
      `extends: ${JSON.stringify(extendsRef)}\n`
    : `# ${module}: a bare module. Give it a plugin inline, or extend another module, e.g.\n` +
      `#   extends: "@k7-core/instruments/fourosc"\n`;
  wsWrite(join(moduleDir, "module.yaml"), body);
  return rel;
}

/** What an io module's `module.yaml` SAYS — the role line is what the loader reads; the rest is prose for the reader (docs/moduleTypes.md). */
function ioModuleBody(
  module: string,
  role: "in" | "out" | "file" | "camera" | "midi",
): string {
  if (role === "in")
    return (
      `# ${module}: this machine's audio input, the live rig's IN.\n` +
      `#\n` +
      `# \`monitor: "auto"\` is audible once its track is armed; "on" always, "off" never. QUOTED,\n` +
      `# because YAML 1.1 would otherwise read "on" and "off" as booleans.\n` +
      `io: in\n` +
      `monitor: "auto"\n` +
      `# …and a trim in dB, applied at the interface ahead of everything: 0 is unity.\n` +
      `gain: 0\n`
    );
  if (role === "camera")
    return (
      `# ${module}: a live picture — the one io source whose signal is video, not audio (docs/camera.md).\n` +
      `#\n` +
      `# It names NO lens: which camera you are on is a fact about your rig. Empty means whichever\n` +
      `# one this machine calls default, so it draws a picture before you have chosen anything.\n` +
      `# Pick it on the node's card, or write the LABEL here — never a deviceId, which is salted\n` +
      `# per browser and rotates:\n` +
      `#\n` +
      `#     camera: "Logitech BRIO"\n` +
      `io: camera\n`
    );
  if (role === "midi")
    return (
      `# ${module}: a MIDI device — the notes a lane records, when this node is wired to it (docs/midiIn.md).\n` +
      `#\n` +
      `# Pick the device on the node's card, or write its LABEL here — never an id, which is per\n` +
      `# browser. Empty records from any device:\n` +
      `#\n` +
      `#     device: "Arturia KeyStep 37"\n` +
      `io: midi\n`
    );
  if (role === "file")
    return (
      `# ${module}: audio off disk rather than off an interface (docs/fileInput.md).\n` +
      `#\n` +
      `# \`source\` is optional and absent is the useful case — pick the file on the node's\n` +
      `# card, or name it here, project-relative:\n` +
      `#\n` +
      `#     source: "clips/original.wav"\n` +
      `io: file\n`
    );
  return (
    `# ${module}: an output sink — OUT the interface, CUE the headphone bus. A module\n` +
    `# reaches it by naming it as a destination in the graph.\n` +
    `io: out\n`
  );
}

/** Create an io NODE directly — the ROLE is the vocabulary's, the NAME is the graph node's; the wiring is this song's own, so it is `nodes/`, never a shared module (docs/moduleTypes.md). */
export function createIoModuleFile(
  dir: string,
  name: string,
  role: "in" | "out" | "file" | "camera" | "midi",
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error(
      `invalid io module name '${name}' — letters, digits, '_' and '-' only`,
    );
  // In a chain project the name is the new chain's, and what comes back is the node's id.
  if (isChainProject(dir))
    return createChainNode(dir, name, ioModuleBody(name, role)).id;
  const rel = `${NODES_DIR}/${name}.yaml`;
  if (wsExists(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  wsWrite(join(dir, rel), ioModuleBody(name, role));
  return rel;
}

// What to call a new use of `module` when nobody said — `<lane>_<module>_<n>`, free across the WHOLE project (instanceName.ts).
export function freeNodeName(
  dir: string,
  module: string,
  lane?: string | null,
): string {
  return instanceName(module, lane, nodeNameTaken(dir));
}

// Is this name already spoken for, as a module OR as a file in `nodes/` — built once so proposing and accepting cannot disagree.
export function nodeNameTaken(dir: string): (name: string) => boolean {
  const taken = loadModules(dir);
  // In a chain project a proposed name becomes a CHAIN's, so a chain file of that name takes it too.
  const chains = isChainProject(dir);
  return (n) =>
    n in taken ||
    wsExists(join(dir, NODES_DIR, `${n}.yaml`)) ||
    (chains && chainTaken(dir, n));
}

// Create one USE of a module: `nodes/<node>.yaml`, FLAT — or a loose chain item, returning its id (docs/chainFiles.md).
export function createNode(
  dir: string,
  category: string,
  module: string,
  node: string,
  // Injected for the same reason loadModuleRefs takes it: what the engine offers is AMBIENT, and a test must not depend on it.
  catalogue: Record<string, LoadedModule> = engineModules(),
): string {
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(node))
    throw new Error(
      `invalid node name '${node}' — letters, digits, '_' and '-' only`,
    );
  // An io module is only its role, so the node is made directly: `node new io/IN IN2` (song-schema/docs/moduleTypes.md).
  if (category === "io") {
    const role = IO_MODULES[module]?.io;
    if (!role)
      throw new Error(
        `unknown io module '${module}' — the app provides: ${Object.keys(IO_MODULES).join(", ")}`,
      );
    if (!isIoSource(role))
      throw new Error(
        `'${module}' is an OUTPUT — MIX, OUT, CUE, RENDER and VIDEO_OUT are built into every graph and take no node`,
      );
    if (node in loadModules(dir))
      throw new Error(
        `the name '${node}' is already a module or node in this project`,
      );
    return createIoModuleFile(dir, node, role);
  }
  // A project looks at its workspace; a template edited with `at` (the builder's "+") bundles its own `modules/`.
  const isProject = isProjectFolder(dir);
  const localRel = isProject
    ? `${SHARED_MODULES_PATH}/${category}/${module}`
    : `modules/${category}/${module}`;
  const local = moduleFileFor(
    isProject
      ? resolve(dir, SHARED_MODULES_PATH, category, module)
      : join(dir, "modules", category, module),
    localRel,
    "module",
  );
  const fromEngine = local ? undefined : catalogue[engineRef(module)];
  if (!local && !fromEngine)
    throw new Error(
      `module '${category}/${module}' is neither in ${isProject ? "the workspace" : "this template"} nor one the engine offers — ` +
        `create it first, or name one of the engine's`,
    );
  // Free among the nodes only: a module of that name keeps its ref, the node the bare name (docs/trackModules.md).
  const rel = `${NODES_DIR}/${node}.yaml`;
  const chains = isChainProject(dir);
  if (!chains && wsExists(join(dir, rel)))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  const plugin = fromEngine?.plugin;
  // The explicit level, which is the form new files are written in — see loadModuleRefs.
  const ref = isProject
    ? `@workspace/${moduleRefOf(category, module)}`
    : `@project/${moduleRefOf(category, module)}`;
  const body = local
    ? `# ${node}: one use of module "${category}/${module}".\n` +
      `# It inherits everything that module says — state only what THIS use changes, e.g.\n` +
      `#   params:\n` +
      `#     Filter Freq: 69\n` +
      `extends: ${JSON.stringify(ref)}\n`
    : `# ${node}: one use of "${module}", a module the engine provides.\n` +
      `# The plugin is named here so the project says what it uses, whatever this machine\n` +
      `# has scanned. Add params: to set it.\n` +
      `plugin:\n` +
      `  type: ${JSON.stringify(String(plugin?.type ?? ""))}\n` +
      `  name: ${JSON.stringify(String(plugin?.name ?? ""))}\n`;
  // A chain project: one item in a chain named `node`, and the node's id is what comes back.
  if (chains) return createChainNode(dir, node, body).id;
  mkdirSync(join(dir, NODES_DIR), { recursive: true });
  wsWrite(join(dir, rel), body);
  return rel;
}

// Clone a module folder (nodes, .vstpreset, rack audio) under a new name, rewriting `name:` if present.
export function cloneModuleFile(
  dir: string,
  category: string,
  name: string,
  newName: string,
): string {
  if (!(category in MODULE_TYPES))
    throw new Error(
      `unknown module category '${category}' — use one of: ${Object.keys(MODULE_TYPES).join(", ")}`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error(
      `invalid module name '${name}' — letters, digits, '_' and '-' only`,
    );
  if (!/^[A-Za-z0-9_-]+$/.test(newName))
    throw new Error(
      `invalid new name '${newName}' — letters, digits, '_' and '-' only`,
    );
  if (name === newName)
    throw new Error("source and destination names are the same");
  // A project clones within the workspace's `_modules`; a template edited with `at` bundles its own `modules/`.
  const isProject = isProjectFolder(dir);
  const localDir = (n: string) =>
    isProject
      ? resolve(dir, SHARED_MODULES_PATH, category, n)
      : join(dir, "modules", category, n);
  const srcDir = localDir(name);
  if (!wsExists(srcDir) || !wsExists(join(srcDir, "module.yaml")))
    throw new Error(`module '${category}/${name}' not found`);
  const destDir = localDir(newName);
  const destRel = isProject
    ? `${SHARED_MODULES_PATH}/${category}/${newName}`
    : `modules/${category}/${newName}`;
  if (wsExists(destDir)) throw new Error(`folder ${destRel}/ already exists`);
  cpSync(srcDir, destDir, { recursive: true });
  const modPath = join(destDir, "module.yaml"); // rewritten below if it has a `name:` field
  try {
    const body = wsRead(modPath);
    const rewritten = body.replace(
      /^(name\s*:\s*)"[^"]*"/m,
      `$1${JSON.stringify(newName)}`,
    );
    if (rewritten !== body) wsWrite(modPath, rewritten);
  } catch {
    /* read-only or missing — leave as-is */
  }
  return `${destRel}/module.yaml`;
}
