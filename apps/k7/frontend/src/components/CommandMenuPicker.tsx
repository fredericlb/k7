// CommandMenuPicker.tsx — the "where does this show up" cell of the Commandes settings page:
// which right-click menus may offer one command. The catalogue names them (commands.yaml's
// `menu:`), this is the person's own list over it — several at once, since one verb belongs on
// two menus. See ../../docs/contextMenu.md.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { cn } from "@frediverse/ui/lib/utils";
import { type CommandPref, menuChoice } from "../commandPrefs";
import { m } from "../paraglide/messages.js";
import { MENU_ENTITIES, type MenuEntity } from "../types";
import type { PaletteCommand } from "./CommandBar";

/** What each entity is CALLED here — the word the catalogue uses is the id, and this is the row you read. */
const ENTITY_LABEL: Record<MenuEntity, () => string> = {
  track: () => m["menuEntity.track"](),
  group: () => m["menuEntity.group"](),
  node: () => m["menuEntity.node"](),
  event: () => m["menuEntity.event"](),
  param: () => m["menuEntity.param"](),
  curve: () => m["menuEntity.curve"](),
  ruler: () => m["menuEntity.ruler"](),
  marker: () => m["menuEntity.marker"](),
  assembly: () => m["menuEntity.assembly"](),
  warp: () => m["menuEntity.warp"](),
  shot: () => m["menuEntity.shot"](),
  pad: () => m["menuEntity.pad"](),
  note: () => m["menuEntity.note"](),
  tap: () => m["menuEntity.tap"](),
};

/** WHERE a right-click offers this command: the catalogue's own list until someone picks another.
 *  Several entities at once, since one verb belongs on two menus — `node param` on a bloc and on a réglage. */
export function MenuEntityPicker({
  c,
  pref,
  onMenu,
}: {
  c: PaletteCommand;
  pref: CommandPref | undefined;
  onMenu: (
    canonical: string,
    catalogue: readonly MenuEntity[] | undefined,
    next: readonly MenuEntity[],
  ) => void;
}) {
  // null is "partout où ça colle" — the derivation, which is what an untouched command with no `menu:` does.
  const chosen = menuChoice(pref, c.menu);
  const on = chosen ?? MENU_ENTITIES;
  const summary = !chosen
    ? m["cmdMenu.everywhere"]()
    : chosen.length === 0
      ? m["cmdMenu.never"]()
      : chosen.length === 1
        ? chosen[0]
        : m["cmdMenu.types"]({ n: chosen.length });
  const toggle = (e: MenuEntity) =>
    onMenu(
      c.canonical,
      c.menu,
      on.includes(e) ? on.filter((x) => x !== e) : [...on, e],
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={m["cmdMenu.buttonHint"]()}
          className={cn(
            "h-7 w-24 shrink-0 truncate rounded border border-border px-2 text-[11px]",
            chosen ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {summary}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="p-1">
        <DropdownMenuLabel>{m["cmdMenu.label"]()}</DropdownMenuLabel>
        {/* Plain labels rather than menu items: a DropdownMenuItem closes on click, and choosing several takes several clicks. */}
        {MENU_ENTITIES.map((e) => (
          <label
            key={e}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={on.includes(e)}
              onChange={() => toggle(e)}
            />
            <span className="flex-1">{ENTITY_LABEL[e]()}</span>
            <code className="text-[10px] text-muted-foreground">{e}</code>
          </label>
        ))}
        <DropdownMenuSeparator />
        <button
          type="button"
          disabled={!chosen}
          className="w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
          onClick={() => onMenu(c.canonical, c.menu, c.menu ?? MENU_ENTITIES)}
        >
          {m["cmdMenu.giveBack"]({
            what: c.menu ? c.menu.join(", ") : m["cmdMenu.everywhere"](),
          })}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
