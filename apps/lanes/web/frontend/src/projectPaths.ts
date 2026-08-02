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
