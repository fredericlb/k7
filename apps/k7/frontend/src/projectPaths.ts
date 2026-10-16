// projectPaths.ts — which KIND of project file a path is, and what its id is: what the
// editor asks to decide whether to show a note grid, a waveform, or a ▶ gutter. In ONE
// place so the conventions can't drift apart between features. Matched with `(^|\/)` rather
// than an anchored `^`, since a path may carry a project-folder prefix in a workspace.

/** A project file's extension. `.yml` too: it is the same format under another spelling. */
const PROJECT_EXT = /\.(?:ya?ml|k7x)$/i;

const kind = (folder: string): RegExp =>
  new RegExp(`(^|/)${folder}/[^/]+.(?:ya?ml|k7x)$`, "i");

/** A MIDI sequence file — the Editor panel previews its inline notes. */
export const isSeqFile = (path: string): boolean =>
  kind("sequences").test(norm(path));
/** A clip file — audio (a waveform) or video. */
export const isClipFile = (path: string): boolean =>
  kind("clips").test(norm(path));
/** A LANE's file — a node in `nodes/`, or a chain project's `tracks/`; deliberately loose, since it decides whether the minimap points at a track. */
export const isTrackFile = (path: string): boolean =>
  kind("nodes").test(norm(path)) || kind("tracks").test(norm(path));
/** A PICTURE lane's placement file: a flat mapping whose `events:` lists placements, in seconds (VideoReadersStrip.tsx). */
export const isVideoTrackFile = (path: string): boolean =>
  kind("video_tracks").test(norm(path));

/** A module file — the one whose rack's `source:` names a file BESIDE it, rather than the project-relative path a clip's source is. */
export const isRackModuleFile = (path: string): boolean =>
  /(^|\/)modules\/[^/]+\/[^/]+\/module\.(?:ya?ml|k7x)$/i.test(norm(path));

/** The chain-`use` key a file answers to in `hints.racks` — a module's folder name or a NODE's stem, so both spellings ask one key. */
export const rackKeyOf = (path: string): string | null => {
  const p = norm(path);
  if (isRackModuleFile(p))
    return (
      p
        .replace(/\/module\.(?:ya?ml|k7x)$/i, "")
        .split("/")
        .pop() ?? null
    );
  // A chain project's file holds many nodes, keyed by uuid, so its path names none (packages/song/docs/chainFiles.md).
  const m = /(^|\/)nodes\/([^/]+)\.(?:ya?ml|k7x)$/i.exec(p);
  return m ? m[2] : null;
};

/** A module file the BUILDER opens — both, in both trees, since the builder edits both and its routes take either. */
export const isModuleFile = (path: string): boolean =>
  /(^|\/)_?modules\/[^/]+\/([^/]+\/)?(module|ui)\.(?:ya?ml|k7x)$/i.test(
    norm(path),
  );

/** The file in `files` that IS `<folder>/<id>`, or null — a lookup and not a search, since `tracks/kick` and `clips/kick` both exist. */
export function entityFile(
  files: string[],
  folder: string,
  id: string,
): string | null {
  const want = new RegExp(
    `(^|/)${esc(folder)}/${esc(id)}\\.(?:ya?ml|k7x)$`,
    "i",
  );
  return files.find((p) => want.test(norm(p))) ?? null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A path with forward slashes, whatever the platform handed us. */
export const norm = (path: string): string => path.replace(/\\/g, "/");

/** A file's id: its name without the folder or the extension. */
export const fileStem = (path: string): string =>
  (norm(path).split("/").pop() ?? "").replace(PROJECT_EXT, "");

/** A project folder, slashed and without a trailing `/`; "" when there is none or it is the workspace itself (`.`). */
export const projectDir = (activeProject: string | null): string => {
  const ap = norm(activeProject ?? "").replace(/\/+$/, "");
  return ap === "." ? "" : ap;
};

/** A workspace-relative path made relative to the project folder, or merely slashed when it lies outside it. */
export function toProjectRelative(
  path: string,
  activeProject: string | null,
): string {
  const p = norm(path);
  const ap = projectDir(activeProject);
  return ap && (p === ap || p.startsWith(`${ap}/`))
    ? p.slice(ap.length + 1)
    : p;
}

/**
 * Is this path inside the project the ENGINE holds? The tree is the whole WORKSPACE now, so a
 * clip or a lane may belong to a project that is not playing — and every rule above matches on
 * `(^|/)`, which cannot tell them apart. See packages/file-service/docs/activeProject.md.
 */
export function inActiveProject(
  path: string,
  activeProject: string | null,
): boolean {
  if (activeProject === null) return false;
  const ap = projectDir(activeProject);
  // An empty folder is the workspace itself being the project: everything in it is the project's.
  if (!ap) return true;
  const p = norm(path);
  return p === ap || p.startsWith(`${ap}/`);
}

/** The generic module file beside `rel` — a node's sibling. */
export const moduleFileOf = (rel: string): string =>
  norm(rel).replace(/\/[^/]+\.(?:ya?ml|k7x)$/i, "/module.yaml");

/** The value of a top-level scalar field, quoted or not, with trailing comments and a flow mapping's `,`/`}` dropped. */
export function readScalarField(text: string, key: string): string | null {
  const m = new RegExp(
    `(^|[^A-Za-z0-9_])${key}\\s*:\\s*("[^"]*"|'[^']*'|[^\\n,}]*)`,
  ).exec(text);
  if (!m) return null;
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    return v.slice(1, -1);
  v = v.replace(/\s+(#|\/\/).*$/, "").trim();
  return v || null;
}
