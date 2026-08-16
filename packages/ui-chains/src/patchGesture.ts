// patchGesture.ts — what a press or a release on a socket DOES, given whether a cable is already
// in hand. One socket answers two gestures: press-drag-release, and click-then-click. Here rather
// than in the renderer because telling them apart is a decision with a right and a wrong answer,
// and this is the half of the graph that has tests. See docs/cable.md.

/** What the renderer should do with this pointer event. */
export type PatchAct = "arm" | "land" | "nothing";

/**
 * The act a pointer event on an ARMED socket calls for.
 *
 * `held` is the cable in hand, if there is one. `armedFrom` is the socket the current press armed
 * from — null between gestures — and `here` is the socket under the pointer.
 *
 * A PRESS lands a cable already in hand, and otherwise starts one. That is what makes a drag
 * possible at all: a cable cannot follow the cursor if it is not drawn until the button comes
 * back up, and a click event does not exist until then.
 *
 * A RELEASE only ever lands, and only somewhere OTHER than where the press armed from. Releasing
 * where you pressed is how a click looks to a pointer, and a click has to leave the cable in hand
 * so a second one can land it — that is the whole click-then-click gesture, which stays.
 *
 * Both halves being live is what lets one socket answer both without a mode, a timer, or a
 * distance threshold to guess at.
 */
export function patchAct(
  phase: "down" | "up",
  held: boolean,
  armedFrom: string | null,
  here: string,
): PatchAct {
  if (phase === "down") return held ? "land" : "arm";
  return held && armedFrom !== here ? "land" : "nothing";
}
