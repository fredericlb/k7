// menuTabs.ts — the right-click menu's TABS: one per kind of thing its rows act on, read off the
// command's first word (`track mute` is the track's, `ui file` the shell's). A tab exists only
// when at least one row falls in it, `ui` sits last since the clicked thing comes first, and the
// plural `events` is the event's. See docs/contextMenu.md, "Tabs".

import type { MenuItem } from "./contextMenu";

/** Heads that are another head's, said once: the range verbs act on events too. */
const SAME_AS: Record<string, string> = { events: "event" };

/** The tab a row belongs to: its command's first word. */
export const menuTab = (item: Pick<MenuItem, "verb">): string => {
  const head = item.verb.split(" ")[0] ?? "";
  return SAME_AS[head] ?? head;
};

/** The rows grouped into tabs, in the order the menu offers them — the shell's own `ui` tab last. */
export function menuTabs(
  items: readonly MenuItem[],
): { tab: string; items: MenuItem[] }[] {
  const tabs = new Map<string, MenuItem[]>();
  for (const it of items) {
    const tab = menuTab(it);
    tabs.set(tab, [...(tabs.get(tab) ?? []), it]);
  }
  const out = [...tabs].map(([tab, rows]) => ({ tab, items: rows }));
  return [
    ...out.filter((t) => t.tab !== "ui"),
    ...out.filter((t) => t.tab === "ui"),
  ];
}
