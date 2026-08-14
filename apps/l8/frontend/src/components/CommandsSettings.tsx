// CommandsSettings.tsx — the "Commandes" settings screen: rename a command, give it an icon, and
// arrange the order menus list them in. Filtered by the ENTITY a command acts on, which its sid
// already says. The catalogue itself is the app's; everything edited here is the person's own
// layer over it (commandPrefs.ts) and travels with their account.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import { ArrowDown, ArrowUp, Loader2, RotateCcw } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import {
  type CommandPrefs,
  entitiesOf,
  entityOf,
  labelOf,
  moveCommand,
  orderCommands,
  setCommandPref,
} from "../commandPrefs";
import type { PaletteCommand } from "./CommandBar";
import { iconByName } from "./IconPicker";

// The whole lucide set is ~1500 components; importing it as a namespace defeats the tree-shaking
// every other icon import here relies on. Lazy, so that cost is paid when this screen opens and
// never on the app's first paint. See IconPicker's header.
const IconPicker = lazy(() => import("./IconPicker"));

export function CommandsSettings({
  commands,
  prefs,
  onChange,
  onBack,
}: {
  /** The catalogue as the backend serves it — sid, line, and the sentence it is listed by. */
  commands: PaletteCommand[];
  prefs: CommandPrefs;
  /** Save the whole document. Debouncing is the caller's: it owns the round trip. */
  onChange: (next: CommandPrefs) => void;
  onBack: () => void;
}) {
  const [entity, setEntity] = useState<string>("");
  const [q, setQ] = useState("");
  const entities = useMemo(() => entitiesOf(commands), [commands]);

  // Ordered FIRST, then filtered — so the arrows move a command against the whole arrangement and
  // not against whatever the filter happens to show. Moving "up" inside a filtered view otherwise
  // means something different from what the menu will do, which is the one thing this page must
  // not get wrong.
  const ordered = useMemo(
    () => orderCommands(commands, prefs),
    [commands, prefs],
  );
  const needle = q.trim().toLowerCase();
  const shown = ordered.filter(
    (c) =>
      (!entity || entityOf(c.canonical) === entity) &&
      (!needle ||
        c.canonical.toLowerCase().includes(needle) ||
        labelOf(c, prefs).toLowerCase().includes(needle)),
  );

  const set = (sid: string, patch: Parameters<typeof setCommandPref>[2]) =>
    onChange(setCommandPref(prefs, sid, patch));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← retour
        </Button>
        <h2 className="text-sm font-medium">Commandes</h2>
        <span className="text-xs text-muted-foreground">
          leur nom, leur icône et l'ordre des menus — pour vous, sur tous vos
          navigateurs
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filtrer…"
          className="ml-auto h-7 w-48 text-xs"
        />
      </header>

      {/* The entity filter: what a command acts on, read off its sid. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-1.5">
        {["", ...entities].map((e) => (
          <button
            type="button"
            key={e || "all"}
            onClick={() => setEntity(e)}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              entity === e
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {e || "tout"}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length}/{commands.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((c) => {
          const Icon = iconByName(prefs[c.canonical]?.icon);
          const touched = !!prefs[c.canonical];
          return (
            <div
              key={c.canonical}
              className="flex items-center gap-2 border-b border-border/50 px-4 py-1.5"
            >
              {/* The icon, and the picker behind it. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="choisir une icône"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : "—"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="p-2">
                  <Suspense
                    fallback={
                      <div className="flex h-24 w-72 items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    }
                  >
                    <IconPicker
                      value={prefs[c.canonical]?.icon}
                      onPick={(icon) => set(c.canonical, { icon })}
                    />
                  </Suspense>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* The label. Placeholder is the catalogue's own sentence, so an empty field reads
                  as "unchanged" rather than as "nameless". */}
              <Input
                value={prefs[c.canonical]?.label ?? ""}
                placeholder={c.readable || c.canonical}
                onChange={(e) => set(c.canonical, { label: e.target.value })}
                className="h-7 flex-1 text-xs"
              />
              <code className="w-56 shrink-0 truncate text-[11px] text-muted-foreground">
                {c.canonical}
              </code>

              <Button
                size="icon-xs"
                variant="ghost"
                title="monter"
                onClick={() =>
                  onChange(moveCommand(commands, prefs, c.canonical, -1))
                }
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title="descendre"
                onClick={() =>
                  onChange(moveCommand(commands, prefs, c.canonical, 1))
                }
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!touched}
                title="rendre à l'app"
                onClick={() =>
                  set(c.canonical, {
                    label: undefined,
                    icon: undefined,
                    order: undefined,
                  })
                }
              >
                <RotateCcw
                  className={cn("h-3.5 w-3.5", !touched && "opacity-30")}
                />
              </Button>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            aucune commande ne correspond
          </p>
        )}
      </div>
    </div>
  );
}
