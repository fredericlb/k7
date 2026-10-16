// confirm.ts — a question before something that does not come back, asked in the page and in this
// catalogue's words. It needs an <AskHost/> mounted where the screen is drawn, or it answers no.

import { askConfirm } from "@frediverse/ui/ask";
import { m } from "./paraglide/messages.js";

/** Ask `title`, the confirm labelled `confirmLabel` (Delete by default); false when dismissed. */
export function confirmLoss(
  title: string,
  confirmLabel: string = m["common.delete"](),
): Promise<boolean> {
  return askConfirm({
    title,
    danger: true,
    confirmLabel,
    cancelLabel: m["common.cancel"](),
  });
}
