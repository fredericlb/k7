// projectPaths.ts — which KIND of project file a path is, and what its id is: what the
// editor asks to decide whether to show a note grid, a waveform, or a ▶ gutter. In ONE
// place so the conventions can't drift apart between features. Matched with `(^|\/)` rather
// than an anchored `^`, since a path may carry a project-folder prefix in a workspace.

/** A project file's extension. `.yml` too: it is the same format under another spelling. */
export const PROJECT_EXT = /\.ya?ml$/i;

const kind = (folder: string): RegExp =>
  new RegExp(`(^|/)${folder}/[^/]+.ya?ml$`, "i");

/** A MIDI sequence file — the Editor panel previews its inline notes. */
export const isSeqFile = (path: string): boolean =>
  kind("sequences").test(norm(path));
/** A clip file — audio (a waveform) or video. */
export const isClipFile = (path: string): boolean =>
  kind("clips").test(norm(path));
/** A LANE's file — a node in `nodes/`; deliberately the loose test, since what it decides is whether the minimap points at a track. */
export const isTrackFile = (path: string): boolean =>
  kind("nodes").test(norm(path));
/** A PICTURE lane's placement file: a flat mapping whose `events:` lists placements, in seconds (VideoReadersStrip.tsx). */
export const isVideoTrackFile = (path: string): boolean =>
  kind("video_tracks").test(norm(path));

/** A module file — the one whose rack's `source:` names a file BESIDE it, rather than the project-relative path a clip's source is. */
export const isRackModuleFile = (path: string): boolean =>
  /(^|\/)modules\/[^/]+\/[^/]+\/module\.ya?ml$/i.test(norm(path));

/** The chain-`use` key a file answers to in `hints.racks` — a module's folder name or a NODE's stem, so both spellings ask one key. */
export const rackKeyOf = (path: string): string | null => {
  const p = norm(path);
  if (isRackModuleFile(p))
    return (
      p
        .replace(/\/module\.ya?ml$/i, "")
        .split("/")
        .pop() ?? null
    );
  const m = /(^|\/)nodes\/([^/]+)\.ya?ml$/i.exec(p);
  return m ? m[2] : null;
};

/** A module file the BUILDER opens — all three, in both trees, since the builder edits all three and its routes take any. */
export const isModuleFile = (path: string): boolean =>
  /(^|\/)_?modules\/[^/]+\/([^/]+\/)?(module|ui|presets)\.ya?ml$/i.test(
    norm(path),
  );

/** The file in `files` that IS `<folder>/<id>`, or null — a lookup and not a search, since `tracks/kick` and `clips/kick` both exist. */
export function entityFile(
  files: string[],
  folder: string,
  id: string,
): string | null {
  const want = new RegExp(`(^|/)${esc(folder)}/${esc(id)}\\.ya?ml$`, "i");
  return files.find((p) => want.test(norm(p))) ?? null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A path with forward slashes, whatever the platform handed us. */
export const norm = (path: string): string => path.replace(/\\/g, "/");

/** A file's id: its name without the folder or the extension. */
export const fileStem = (path: string): string =>
  (norm(path).split("/").pop() ?? "").replace(PROJECT_EXT, "");

/** The generic module file beside `rel` — a node's sibling. */
export const moduleFileOf = (rel: string): string =>
  norm(rel).replace(/\/[^/]+\.ya?ml$/i, "/module.yaml");

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
