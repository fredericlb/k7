// patchGesture.ts — what a press or a release on a socket DOES, given whether a cable is already
// in hand. One socket answers two gestures: press-drag-release, and click-then-click. Here rather
// than in the renderer because telling them apart is a decision with a right and a wrong answer,
// and this is the half of the graph that has tests. See docs/cable.md.

/** What the renderer should do with this pointer event. */
export type PatchAct = "arm" | "land" | "nothing";

/** The act a pointer event on an ARMED socket calls for — the whole table is in docs/cable.md. */
export function patchAct(
  phase: "down" | "up",
  held: boolean,
  armedFrom: string | null,
  here: string,
): PatchAct {
  if (phase === "down") return held ? "land" : "arm";
  return held && armedFrom !== here ? "land" : "nothing";
}
