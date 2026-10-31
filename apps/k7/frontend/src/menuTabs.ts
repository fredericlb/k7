// menuTabs.ts — the right-click menu's TABS: one per kind of thing its rows act on, read off the
// command's first word (`track mute` is the track's, `ui file` the shell's). A tab exists only
// when at least one row falls in it, `ui` sits last since the clicked thing comes first, and the
// plural `events` is the event's; inside a tab the destructive rows go last, and the arrow keys
// walk the rows. See docs/contextMenu.md, "Tabs".

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

/** The last words of a verb that take something away — with the catalogue's `confirm:`, what the menu draws in red, apart and last. */
const TAKES_AWAY = new Set(["delete", "remove", "unlink"]);

/** Whether a row destroys rather than changes: it asks first, or its verb ends by removing. */
export const isDestructive = (item: Pick<MenuItem, "verb" | "confirm">) =>
  !!item.confirm || TAKES_AWAY.has(item.verb.split(" ").at(-1) ?? "");

/** A tab's rows split in two, each half in its own order — the menu draws the destructive half last, after a separator. */
export const dangerLast = (
  items: readonly MenuItem[],
): { safe: MenuItem[]; danger: MenuItem[] } => ({
  safe: items.filter((it) => !isDestructive(it)),
  danger: items.filter(isDestructive),
});

/** Where Up, Down, Home and End move the focus among `n` rows from `at` (-1 when none has it), or null for another key. */
export function moveFocus(key: string, at: number, n: number): number | null {
  if (!n) return null;
  if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % n;
  if (key === "ArrowUp") return at < 0 ? n - 1 : (at - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}
