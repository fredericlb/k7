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
/** A track's placement file. */
export const isTrackFile = (path: string): boolean =>
  kind("tracks").test(norm(path));
/** A video track's placement file: a flat mapping whose `clips:` lists placements. */
export const isVideoTrackFile = (path: string): boolean =>
  kind("video_tracks").test(norm(path));

/**
 * A module file — `modules/<type>/<name>/module.yaml`.
 *
 * The one whose rack's `source:`/`clip:` names a file BESIDE it (the compiler's
 * resolveRackAudio) rather than the project-relative path a clip's source is.
 */
export const isRackModuleFile = (path: string): boolean =>
  /(^|\/)modules\/[^/]+\/[^/]+\/module\.ya?ml$/i.test(norm(path));

/**
 * A module file the BUILDER opens — `module.yaml`, or either of the two files beside it.
 *
 * All three, because the builder edits all three and its routes take any of them (see `@studio/song`'s
 * uiLibrary.ts and presets.ts). Both trees: a project's `modules/<type>/<name>/` and a shared
 * `_modules/<type>/[<category>/]<leaf>/`, which is one folder deeper.
 */
export const isModuleFile = (path: string): boolean =>
  /(^|\/)_?modules\/[^/]+\/([^/]+\/)?(module|ui|presets)\.ya?ml$/i.test(
    norm(path),
  );

/**
 * The file in `files` that IS `<folder>/<id>`, or null.
 *
 * An id names its file (`entityFiles` in `@studio/song`), so this is a lookup rather than a
 * search — but not a string compare: either spelling of the extension counts, and a path may
 * carry a project-folder prefix. Named rather than fuzzy-matched, because `tracks/kick` and
 * `clips/kick` both exist in plenty of songs and a score on "kick" alone could take either.
 */
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

/** The generic module file beside `rel` — an instance's sibling. */
export const moduleFileOf = (rel: string): string =>
  norm(rel).replace(/\/[^/]+\.ya?ml$/i, "/module.yaml");

/**
 * The value of a top-level scalar field, quoted or not (`source: kick.wav` and
 * `source: "kick.wav"` both read). Trailing `#`/`//` comments are dropped, and so is
 * a `,` or `}` when the field sits inside a flow mapping on one line.
 */
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
