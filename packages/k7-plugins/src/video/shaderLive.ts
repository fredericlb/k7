// shaderLive.ts — a shader knob turned on a card, handed to every viewport drawn on this page at once,
// so the picture moves with the hand. ONE channel for the page, like midiActivity: the card and the
// viewport sit in panes that share no props. The file is still what decides, read back after the write.

/** A viewport's answer: true when it HAD a pass of that node to set. */
type Listener = (node: string, name: string, value: number) => boolean;

const listeners = new Set<Listener>();

/** A knob of `node` moved: every mounted viewport sets it on its passes; false when none had one — a strip left neutral draws no pass. */
export function pushShaderParam(
  node: string,
  name: string,
  value: number,
): boolean {
  let drawn = false;
  for (const l of listeners) drawn = l(node, name, value) || drawn;
  return drawn;
}

/** What a viewport listens with; the returned function stops it. */
export function listenShaderParams(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
