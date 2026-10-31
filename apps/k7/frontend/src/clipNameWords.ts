// clipNameWords.ts — the app's messages a clip's shown name is spelled with (clipNames.ts), kept apart
// so that module stays pure and testable without the generated messages.

import type { ClipNameWords } from "./clipNames";
import { m } from "./paraglide/messages.js";

export const CLIP_NAME_WORDS: ClipNameWords = {
  take: ({ lane, bar }) => m["clip.takeName"]({ lane, bar }),
  sequence: ({ lane, n }) => m["clip.sequenceName"]({ lane, n }),
};
