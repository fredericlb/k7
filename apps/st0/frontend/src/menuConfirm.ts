// menuConfirm.ts — the question a right-click asks before an entry the catalogue marks `confirm:`.
// One function for every host of the menu, so the shell and a second device ask the same thing.
// The title is the command's own sentence, the body the exact line it will run (docs/contextMenu.md).

import { askConfirm } from "@studio/project-shell/ask";
import type { MenuItem } from "./contextMenu";
import { m } from "./paraglide/messages.js";

/** True when the entry may run: it asks nothing, or the person said yes. */
export function confirmMenuItem(item: MenuItem): Promise<boolean> {
  if (!item.confirm) return Promise.resolve(true);
  return askConfirm({
    title: `${item.description}?`,
    body: item.command,
    confirmLabel: m["menu.confirm"](),
    cancelLabel: m["common.cancel"](),
    danger: true,
  });
}
