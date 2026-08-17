// CommandsSettings.tsx — the "Commandes" settings screen: rename a command, give it an icon,
// bind it a keyboard shortcut, and arrange the order menus list them in. Filtered by the ENTITY
// a command acts on. The catalogue itself is the app's; everything edited here is the person's
// own layer over it (commandPrefs.ts + keys.ts's effectiveKeys) and travels with their account.
// It edits a DRAFT and saves on a button — docs/shell.md says why this page is the exception.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Input } from "@frediverse/ui/input";
import { cn } from "@frediverse/ui/lib/utils";
import { ArrowDown, ArrowUp, Layers, Loader2, RotateCcw } from "lucide-react";
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
} from "../commandPrefs";
import { useLocale } from "../i18n";
import {
  effectiveKeys,
  KEY_NONE,
  keyForCommand,
  keyLabel,
  keyToken,
} from "../keys";
import { type IconSet, useIcons } from "../lucideIcons";
import type { PaletteCommand } from "./CommandBar";

// The whole lucide set is ~1500 components; importing it as a namespace defeats the tree-shaking
// every other icon import here relies on. Lazy, so that cost is paid when this screen opens and
// never on the app's first paint. See IconPicker's header.
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
  // Every language the app is built with, so a language added to the catalogue grows a field here
  // the same day — and the CURRENT one, only to mark which field is the one you are reading in.
  const { locale, locales } = useLocale();
  // Shared with the context menus, so this page and they resolve a name the same way — and the
  // set is fetched once for both. Null for the first frames, which shows an empty icon button.
  const icons = useIcons();
  const entities = useMemo(() => entitiesOf(commands), [commands]);
  // Every head the catalogue uses, so a PLURAL verb lists under its singular — see entityGroup.
  const heads = useMemo(() => commandHeads(commands), [commands]);

  /**
   * The edits, held HERE until the Save button.
   *
   * This screen used to write through on every keystroke, and it was the wrong shape twice over:
   * a PATCH per character down the wire, and — because the document lives at the root of the app —
   * a re-render of the whole shell behind the overlay for each one. Renaming a command was
   * unusable. Read docs/shell.md for why this is the one settings page with a button.
   */
  const [draft, setDraft] = useState<CommandPrefs>(prefs);
  const dirty = draft !== prefs;
  // The saved document changed under us: the first fetch landing, or our own save coming back.
  // After a save the two are the same object, so this costs a bail-out and not a render.
  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  // Stable, all three: the rows are memoised on them, and the key-capture effect below depends
  // on the first. Functional updates are what makes that possible — none of them reads `draft`.
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

  // Ordered FIRST, then filtered — so the arrows move a command against the whole arrangement and
  // not against whatever the filter happens to show. Moving "up" inside a filtered view otherwise
  // means something different from what the menu will do, which is the one thing this page must
  // not get wrong.
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

  /**
   * The shortcut each row shows, resolved ONCE for the whole page.
   *
   * A row cannot answer this on its own — a key can be stolen, and the losing row's cell has to go
   * blank — so it used to call `keyForCommand(canonical, prefs)` per row, and that call rebuilds
   * the entire effective map. Two hundred rebuilds per keystroke, which is most of what made this
   * page slow to type in. First token wins, as `keyForCommand`'s `find` did.
   */
  const keyByCommand = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [token, canonical] of Object.entries(effectiveKeys(draft)))
      if (!(canonical in out)) out[canonical] = keyLabel(token);
    return out;
  }, [draft]);

  // The row whose shortcut cell is waiting for a key, by canonical. One at a time, obviously.
  const [capturing, setCapturing] = useState<string | null>(null);
  /**
   * The capture itself. Window + capture phase, so the press reaches nothing else — the
   * shell's own key listener already stands down while a settings screen is open, but the
   * browser's focused-button semantics (Space clicks what you last clicked) do not.
   *
   * Escape renounces. Backspace/Delete takes the shortcut away: as KEY_NONE when the command
   * has a default (deleting the pref would resurrect it), by dropping the field when it never
   * had one. Choosing the default again is not an override, so the field comes off instead —
   * a person putting a key back should leave no entry behind.
   */
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
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
      if (!token) return; // a ⌘/⌃/⌥ chord — those stay the browser's, so they can't be bound
      patch(capturing, {
        key: token === keyForCommand(capturing) ? undefined : token,
      });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, patch]);

  // Ctrl+S means the button, as it does in the module builder — the shell's own key listener
  // stands down while a settings screen is open, so without this the browser would offer to save
  // the page. Not while capturing: that effect owns the keyboard, and its ⌃ chords are refused.
  useEffect(() => {
    if (capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === "s" && (e.ctrlKey || e.metaKey))) return;
      e.preventDefault();
      if (dirty) onSave(draft);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing, dirty, draft, onSave]);

  // Leaving with edits nobody asked to keep is the one thing a Save button makes possible, so it
  // is the one thing this has to stop.
  const leave = () => {
    if (
      dirty &&
      !window.confirm(
        "Des modifications ne sont pas enregistrées. Les abandonner ?",
      )
    )
      return;
    onBack();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button size="sm" variant="ghost" onClick={leave}>
          ← retour
        </Button>
        <h2 className="text-sm font-medium">Commandes</h2>
        <span className="text-xs text-muted-foreground">
          leur nom, leur icône, leur raccourci et l'ordre des menus — pour vous,
          sur tous vos navigateurs
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filtrer…"
          className="ml-auto h-7 w-48 text-xs"
        />
        {/* The button, and beside it what it would write. A shortcut assigned here does not run
            until it is saved — the app reads the SAVED document — which is what the marker says. */}
        <span
          className={cn(
            "shrink-0 text-xs",
            dirty ? "text-amber-500" : "text-muted-foreground",
          )}
        >
          {dirty ? "non enregistré" : "à jour"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty}
          onClick={() => setDraft(prefs)}
        >
          annuler
        </Button>
        <Button size="sm" disabled={!dirty} onClick={() => onSave(draft)}>
          Enregistrer
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
            {e || "tout"}
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
          />
        ))}
        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            aucune commande ne correspond
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One command's row — memoised, and that is the second half of what made this page usable.
 *
 * Two hundred rows re-rendering for a keystroke in one of them is two hundred radix dropdowns and
 * four hundred inputs reconciled per character. `setCommandPref` copies the document shallowly, so
 * every untouched command's `pref` keeps its identity and every prop below is a primitive or a
 * stable callback: only the row being typed in comes back.
 */
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
              value={pref?.icon}
              onPick={(icon) => onPatch(c.canonical, { icon })}
            />
          </Suspense>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The name, one field per language. Each placeholder is the catalogue's own
          sentence IN THAT language, so an empty field reads as "unchanged" rather than as
          "nameless" — and so the two fields show what they would each leave standing. The
          tag is the locale code: two letters cost less width than a legend would, and this
          row already carries five controls. */}
      {locales.map((l) => (
        <label
          key={l}
          className="flex min-w-0 flex-1 items-center gap-1"
          title={`nom en ${l}`}
        >
          <span
            className={cn(
              "shrink-0 font-mono text-[10px] uppercase",
              l === locale ? "text-foreground" : "text-muted-foreground/60",
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
      {/* The line, and — on the one that acts on SEVERAL — a mark saying so. A plural
          verb lists under its singular (`events move` among the `event` ones), which is
          where anyone would look for it; the badge is what keeps the two tellable apart
          once they are side by side. */}
      <code className="flex w-56 shrink-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
        {plural && (
          <Layers
            className="h-3 w-3 shrink-0 text-primary/70"
            aria-label="agit sur plusieurs à la fois"
          />
        )}
        <span className="truncate">{c.canonical}</span>
      </code>

      {/* On the right-click, or not. Only ever a way to take one AWAY: the menu is
          DERIVED — what you clicked decides which verbs fit it — so ticking this cannot
          put a command somewhere it does not belong. Unticking is for the verb that
          fits and is still clutter, which the catalogue cannot say for you. */}
      <label
        className="flex w-7 shrink-0 items-center justify-center"
        title="proposer cette commande au clic droit"
      >
        <input
          type="checkbox"
          checked={pref?.menu !== false}
          onChange={(e) =>
            // `undefined` rather than `true`, so an untouched command keeps no entry at
            // all — the same rule the label and the icon follow.
            onPatch(c.canonical, { menu: e.target.checked ? undefined : false })
          }
          aria-label="au clic droit"
        />
      </label>

      {/* The shortcut. Click, press a key — Échap annule, ⌫ retire. A stolen key is
          visible without ceremony: the row that held it reads the same effective map
          and its cell goes blank. */}
      <Button
        size="sm"
        variant={capturing ? "default" : "outline"}
        title="cliquer puis presser une touche — Échap annule, ⌫ retire (⇧ passe, ⌘/⌃/⌥ restent au navigateur)"
        className="h-7 w-16 shrink-0 justify-center font-mono text-[11px]"
        onClick={() => onCapture(capturing ? null : c.canonical)}
      >
        {capturing ? "…" : (keyText ?? "—")}
      </Button>

      <Button
        size="icon-xs"
        variant="ghost"
        title="monter"
        onClick={() => onMove(c.canonical, -1)}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="descendre"
        onClick={() => onMove(c.canonical, 1)}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={!touched}
        title="rendre à l'app"
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
