// saveLabel.ts — what a text pane says where a Save button would be. Here rather than in one
// pane because every pane running `useAutosave` owes the person the same sentence: a pane that
// prints only "saved / …" cannot say that a write is being HELD, and the file silently stops
// being written. See @studio/ui-editor's docs/autosave.md for the rule itself.

import type { AutosaveStatus } from "@studio/ui-editor/autosave";
import { m } from "./paraglide/messages.js";

// Functions, not strings: the message is read in the locale of the moment it is drawn.
const SAVE_LABEL: Record<AutosaveStatus, () => string> = {
  // Said rather than left blank: with no Save button, silence reads as "nothing was kept".
  clean: m["save.saved"],
  pending: m["save.pending"],
  saving: m["save.saving"],
  held: m["save.held"],
  error: m["save.error"],
};

/** Is this a state the person has to do something about? The two that need the reason spelt out. */
export const needsAttention = (status: AutosaveStatus): boolean =>
  status === "held" || status === "error";

/** The full sentence: the state, and — for the two that are stuck — why. */
export function saveLabel(
  status: AutosaveStatus,
  reason: string | null,
): string {
  const head = SAVE_LABEL[status]();
  return needsAttention(status) && reason ? `${head} — ${reason}` : head;
}
