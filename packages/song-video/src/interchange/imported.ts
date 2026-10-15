// imported.ts — a cut read from another editor, before it becomes this project's files: tracks
// of shots in timeline seconds, each naming its media as the file named it. Both readers (OTIO,
// EDL) produce this, so the verb that writes lanes knows one shape. A dissolve here is already
// THIS app's: the incoming shot's `fadeIn`, at its own start. See docs/interchange.md.

/** One shot as it lands on a lane: where, how long, from where in its source, and how it arrives. */
export interface ImportedShot {
  name: string;
  /** The media as the file names it — a URL, a path, or (an EDL) only a clip name. */
  media: string;
  start: number;
  length: number;
  sourceFrom: number;
  speed?: number;
  fadeIn?: number;
}

export interface ImportedTrack {
  name: string;
  shots: ImportedShot[];
}

/** The cut, bottom track first, and what the reader could not carry. */
export interface ImportedCut {
  name: string;
  fps: number;
  tracks: ImportedTrack[];
  skipped: string[];
}

/** Turn a dissolve centred on a cut into this app's: B starts `inOffset` earlier and fades over both halves, A runs `outOffset` longer. */
// Here the incoming shot carries the transition from its own start, and the outgoing one runs on under it.
export function dissolveIntoFadeIn(
  a: ImportedShot | undefined,
  b: ImportedShot,
  inOffset: number,
  outOffset: number,
): void {
  const speed = b.speed ?? 1;
  b.start -= inOffset;
  b.length += inOffset;
  b.sourceFrom -= inOffset * speed;
  b.fadeIn = inOffset + outOffset;
  if (a) a.length += outOffset;
}
