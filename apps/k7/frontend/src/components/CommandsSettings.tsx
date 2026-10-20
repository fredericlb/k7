// CommandsSettings.tsx — the "Commandes" settings screen: rename a command, give it an icon,
// bind it a keyboard shortcut, say which right-clicks offer it, and arrange the order menus list
// them in. Filtered by the ENTITY a command acts on. The catalogue itself is the app's; everything edited here is the person's
// own layer over it (commandPrefs.ts + keys.ts's effectiveKeys) and travels with their account.
// It edits a DRAFT and saves on a button — docs/shell.md says why this page is the exception.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Layers,
  Loader2,
  RotateCcw,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import { askConfirm } from "@studio/project-shell/ask";
import { useUnsavedGuard } from "@studio/ui-editor/unsaved";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type CommandPref,
  type CommandPrefs,
  commandHeads,
  entitiesOf,
  entityGroup,
  isPluralCommand,
  labelIn,
  labelOf,
  moveCommand,
  orderCommands,
  setCommandLabel,
  setCommandPref,
  setMenuEntities,
} from "../commandPrefs";
import { useWindowKey } from "../hooks/useWindowKey";
import { useLocale } from "../i18n";
import {
  effectiveKeys,
  KEY_NONE,
  keyForCommand,
  keyLabel,
  keyToken,
} from "../keys";
import { type IconSet, useIcons } from "../lucideIcons";
import { m } from "../paraglide/messages.js";
import { MENU_ENTITIES, type MenuEntity } from "../types";
import type { PaletteCommand } from "./CommandBar";
import { MenuEntityPicker } from "./CommandMenuPicker";

// The whole lucide set is ~1500 components, so it is LAZY: that cost is paid when this screen opens (see IconPicker's header).
const IconPicker = lazy(() => import("./IconPicker"));

/** One command's patch, as the row hands it up — the same shape `setCommandPref` takes. */
type Patch = Parameters<typeof setCommandPref>[2];

export function CommandsSettings({
  commands,
  prefs,
  onSave,
  onBack,
}: {
  /** The catalogue as the backend serves it — sid, line, and the sentence it is listed by. */
  commands: PaletteCommand[];
  /** The SAVED document. Everything on screen is a draft over it until the button is pressed. */
  prefs: CommandPrefs;
  /** Write the whole document. Called by the Save button and by nothing else. */
  onSave: (next: CommandPrefs) => void;
  onBack: () => void;
}) {
  const [entity, setEntity] = useState<string>("");
  const [q, setQ] = useState("");
  // Every language the app is built with, so a new one grows a field here — and the CURRENT one, to mark which you are reading in.
  const { locale, locales } = useLocale();
  // Shared with the context menus, so this page and they resolve a name the same way; null for the first frames.
  const icons = useIcons();
  const entities = useMemo(() => entitiesOf(commands), [commands]);
  // Every head the catalogue uses, so a PLURAL verb lists under its singular — see entityGroup.
  const heads = useMemo(() => commandHeads(commands), [commands]);

  /** The edits, held HERE until the Save button — a write-through is a PATCH and a whole-shell re-render per character (docs/shell.md). */
  const [draft, setDraft] = useState<CommandPrefs>(prefs);
  const dirty = draft !== prefs;
  // `leave` below guards the in-app road; this one guards the reload, which was the way out with no question.
  useUnsavedGuard(dirty);
  // The saved document changed under us: the first fetch landing, or our own save coming back, which costs a bail-out.
  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  // Stable, all three: the rows are memoised on them, which functional updates are what make possible.
  const patch = useCallback(
    (canonical: string, p: Patch) =>
      setDraft((d) => setCommandPref(d, canonical, p)),
    [],
  );
  const rename = useCallback(
    (canonical: string, l: string, text: string) =>
      setDraft((d) => setCommandLabel(d, canonical, l, text, locales)),
    [locales],
  );
  const move = useCallback(
    (canonical: string, by: -1 | 1) =>
      setDraft((d) => moveCommand(commands, d, canonical, by)),
    [commands],
  );
  const menu = useCallback(
    (
      canonical: string,
      catalogue: readonly MenuEntity[] | undefined,
      next: readonly MenuEntity[],
    ) =>
      setDraft((d) =>
        setMenuEntities(d, canonical, catalogue, next, MENU_ENTITIES),
      ),
    [],
  );

  // Ordered FIRST, then filtered — so the arrows move a command against the whole arrangement, not against what the filter shows.
  const ordered = useMemo(
    () => orderCommands(commands, draft),
    [commands, draft],
  );
  const needle = q.trim().toLowerCase();
  const shown = ordered.filter(
    (c) =>
      (!entity || entityGroup(c.canonical, heads) === entity) &&
      (!needle ||
        c.canonical.toLowerCase().includes(needle) ||
        labelOf(c, draft, locale).toLowerCase().includes(needle)),
  );

  /** The shortcut each row shows, resolved ONCE for the whole page: per row it rebuilt the entire effective map, two hundred times a keystroke. */
  const keyByCommand = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [token, canonical] of Object.entries(effectiveKeys(draft)))
      if (!(canonical in out)) out[canonical] = keyLabel(token);
    return out;
  }, [draft]);

  // The row whose shortcut cell is waiting for a key, by canonical. One at a time, obviously.
  const [capturing, setCapturing] = useState<string | null>(null);
  /** The capture itself, on the window and in the capture phase; Escape renounces, and Backspace takes the shortcut away as KEY_NONE. */
  useWindowKey(
    (e) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; // still choosing
      if (e.key === "Backspace" || e.key === "Delete") {
        patch(capturing, {
          key: keyForCommand(capturing) ? KEY_NONE : undefined,
        });
        setCapturing(null);
        return;
      }
      const token = keyToken(e);
      // A modifier chord stays the browser's — ⌃C and ⌃V are the two exceptions, being the shell's own keys (keys.ts's CHORDS).
      if (!token) return;
      patch(capturing, {
        key: token === keyForCommand(capturing) ? undefined : token,
      });
      setCapturing(null);
    },
    { enabled: !!capturing, capture: true },
  );

  // Ctrl+S means the button, as in the module builder; not while capturing, since that effect owns the keyboard.
  useWindowKey(
    (e) => {
      if (!(e.key === "s" && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      if (dirty) onSave(draft);
    },
    { enabled: !capturing },
  );

  // Leaving with edits nobody asked to keep is the one thing a Save button makes possible, so it is the one thing this stops.
  const leave = async () => {
    if (!dirty) return onBack();
    const agreed = await askConfirm({
      title: m["cmds.discardTitle"](),
      body: m["cmds.discardBody"](),
      confirmLabel: m["cmds.discard"](),
      danger: true,
    });
    if (agreed) onBack();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => void leave()}>
          <ArrowLeft className="h-4 w-4" /> {m["common.back"]()}
        </Button>
        <h2 className="text-sm font-medium">{m["cmds.title"]()}</h2>
        <span className="text-xs text-muted-foreground">
          {m["cmds.subtitle"]()}
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m["common.filter"]()}
          className="ml-auto h-7 w-48 text-xs"
        />
        {/* The button, and beside it what it would write: a shortcut assigned here does not run until it is saved. */}
        <span
          className={cn(
            "shrink-0 text-xs",
            dirty ? "text-amber-500" : "text-muted-foreground",
          )}
        >
          {dirty ? m["cmds.unsaved"]() : m["cmds.upToDate"]()}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => setDraft(prefs)}
        >
          {m["common.cancelLower"]()}
        </Button>
        <Button size="sm" disabled={!dirty} onClick={() => onSave(draft)}>
          {m["common.save"]()}
        </Button>
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
            {e || m["cmds.all"]()}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length}/{commands.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((c) => (
          <CommandRow
            key={c.canonical}
            c={c}
            pref={draft[c.canonical]}
            icons={icons}
            locale={locale}
            locales={locales}
            plural={isPluralCommand(c.canonical, heads)}
            keyText={keyByCommand[c.canonical] ?? null}
            capturing={capturing === c.canonical}
            onCapture={setCapturing}
            onPatch={patch}
            onRename={rename}
            onMove={move}
            onMenu={menu}
          />
        ))}
        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {m["cmds.noMatch"]()}
          </p>
        )}
      </div>
    </div>
  );
}

/** One command's row — memoised, which is the second half of what made this page usable: a keystroke reconciled two hundred rows. */
const CommandRow = memo(function CommandRow({
  c,
  pref,
  icons,
  locale,
  locales,
  plural,
  keyText,
  capturing,
  onCapture,
  onPatch,
  onRename,
  onMove,
  onMenu,
}: {
  c: PaletteCommand;
  pref: CommandPref | undefined;
  icons: IconSet | null;
  locale: string;
  locales: readonly string[];
  plural: boolean;
  /** Already resolved against the whole page — see `keyByCommand`. */
  keyText: string | null;
  capturing: boolean;
  onCapture: (canonical: string | null) => void;
  onPatch: (canonical: string, patch: Patch) => void;
  onRename: (canonical: string, locale: string, text: string) => void;
  onMove: (canonical: string, by: -1 | 1) => void;
  /** The whole list at once — a pick is "these ones", never a diff. */
  onMenu: (
    canonical: string,
    catalogue: readonly MenuEntity[] | undefined,
    next: readonly MenuEntity[],
  ) => void;
}) {
  const name = pref?.icon;
  const Icon = name ? icons?.[name] : undefined;
  const touched = !!pref;
  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-4 py-1.5">
      {/* The icon, and the picker behind it. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={m["cmds.pickIcon"]()}
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
              value={pref?.icon}
              onPick={(icon) => onPatch(c.canonical, { icon })}
            />
          </Suspense>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The name, one field per language, each placeholder the catalogue's own sentence IN THAT language (docs/shell.md). */}
      {locales.map((l) => (
        <label
          key={l}
          className="flex min-w-0 flex-1 items-center gap-1"
          title={m["cmds.nameIn"]({ locale: l })}
        >
          <span
            className={cn(
              "shrink-0 font-mono text-[10px] uppercase",
              l === locale ? "text-foreground" : "text-faint",
            )}
          >
            {l}
          </span>
          <Input
            value={labelIn(pref?.label, l)}
            placeholder={c.readableBy?.[l] || c.readable || c.canonical}
            onChange={(e) => onRename(c.canonical, l, e.target.value)}
            className="h-7 min-w-0 flex-1 text-xs"
          />
        </label>
      ))}
      {/* The line, with a mark on the one that acts on SEVERAL: a plural verb lists under its singular, where anyone would look. */}
      <code className="flex w-56 shrink-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
        {plural && (
          <Layers
            className="h-3 w-3 shrink-0 text-primary-text/70"
            aria-label={m["cmds.plural"]()}
          />
        )}
        <span className="truncate">{c.canonical}</span>
      </code>

      {/* WHICH right-clicks offer it — the catalogue's own list until you touch it. */}
      <MenuEntityPicker c={c} pref={pref} onMenu={onMenu} />

      {/* The shortcut: click, press a key, and a stolen one goes blank in the row that held it, both reading one effective map. */}
      <Button
        size="sm"
        variant={capturing ? "default" : "outline"}
        title={m["cmds.keyHint"]()}
        className="h-7 w-16 shrink-0 justify-center font-mono text-[11px]"
        onClick={() => onCapture(capturing ? null : c.canonical)}
      >
        {capturing ? "…" : (keyText ?? "—")}
      </Button>

      <Button
        size="icon-xs"
        variant="ghost"
        title={m["cmds.up"]()}
        onClick={() => onMove(c.canonical, -1)}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title={m["cmds.down"]()}
        onClick={() => onMove(c.canonical, 1)}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={!touched}
        title={m["cmds.giveBack"]()}
        onClick={() =>
          onPatch(c.canonical, {
            label: undefined,
            icon: undefined,
            order: undefined,
            key: undefined,
            menu: undefined,
          })
        }
      >
        <RotateCcw className={cn("h-3.5 w-3.5", !touched && "opacity-30")} />
      </Button>
    </div>
  );
});
