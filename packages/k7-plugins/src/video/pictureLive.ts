// pictureLive.ts — an edit of the picture made by hand, handed to every viewport drawn on this page at
// once, so the picture moves with the hand: a shader knob turned on a card, a lane dragged on the frame.
// ONE channel for the page, like midiActivity: the hand and the viewport sit in panes that share no
// props. The file is still what decides, read back after the write (packages/song/docs/videoMixer.md).

type Rect = { x: number; y: number; w: number; h: number };

/** A viewport's answers: true when it HAD a pass, or a layer, to set. */
interface Listener {
  param: (node: string, name: string, value: number) => boolean;
  rect: (lane: string, r: Rect) => boolean;
}

const listeners = new Set<Listener>();

/** A knob of `node` moved: every mounted viewport sets it on its passes; false when none had one. */
export function pushShaderParam(
  node: string,
  name: string,
  value: number,
): boolean {
  let drawn = false;
  for (const l of listeners) drawn = l.param(node, name, value) || drawn;
  return drawn;
}

/** A lane's rect dragged: every mounted viewport draws it there at the next frame. */
export function pushLayerRect(lane: string, r: Rect): boolean {
  let drawn = false;
  for (const l of listeners) drawn = l.rect(lane, r) || drawn;
  return drawn;
}

/** What a viewport listens with; the returned function stops it. */
export function listenPictureEdits(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
