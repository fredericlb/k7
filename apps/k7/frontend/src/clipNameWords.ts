// clipNameWords.ts — the app's messages a clip's shown name is spelled with (clipNames.ts), kept apart
// so that module stays pure and testable without the generated messages — and the namers a menu
// title and a history row read ids through, built on them.

import { type ClipNameWords, clipShownName, laneNamer } from "./clipNames";
import type { MenuNamers } from "./menuTitle";
import { m } from "./paraglide/messages.js";

export const CLIP_NAME_WORDS: ClipNameWords = {
  take: ({ lane, bar }) => m["clip.takeName"]({ lane, bar }),
  sequence: ({ lane, n }) => m["clip.sequenceName"]({ lane, n }),
};

/** A lane id as its label and a clip ref as its shown name, from the project's lanes. */
export function shownNamers(
  tracks: readonly { id: string; name: string }[],
): Required<MenuNamers> {
  const lane = laneNamer(tracks);
  return {
    lane,
    clip: (ref) => clipShownName(ref, lane, CLIP_NAME_WORDS),
  };
}
