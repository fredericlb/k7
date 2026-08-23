// CommandParams.tsx — the parameter form, as a small panel in the bottom-right corner.
//
// A panel and not a step in the bar, so every question is on screen at once and an answer given
// three fields ago can be changed without unwinding the ones after it. The corner is the one
// place it can sit while a gesture elsewhere answers one of its fields.
//
// It holds NO state: CommandBar owns the command, the answers and the gesture inlets, and two
// copies of that would be two commands. See docs/commandBar.md.

import { cn } from "@frediverse/ui/lib/utils";
import { createPortal } from "react-dom";
import type { EnterAction } from "../commandFill";
import type { ArgClass } from "../types";
import type { PaletteArg, PaletteCommand } from "./CommandBar";

export function CommandParams({
  command,
  values,
  active,
  suggestions,
  selected,
  argColor,
  enterDoes,
  onType,
  onFocusField,
  onPick,
  onHover,
  onKeyDown,
  inputRef,
}: {
  command: PaletteCommand;
  values: readonly string[];
  active: number;
  /** The active field's vocabulary, already ranked — empty when it has none. */
  suggestions: readonly string[];
  selected: number;
  argColor: Record<ArgClass, string>;
  /** What Enter will do THIS press, so the footer can name it — see `enterAction`. */
  enterDoes: EnterAction["kind"];
  onType: (index: number, value: string) => void;
  onFocusField: (index: number) => void;
  onPick: (value: string) => void;
  onHover: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const arg: PaletteArg | undefined = command.args[active];

  return createPortal(
    <section
      // Portalled and fixed: the bar it belongs to is a flex row, and a panel this size inside it would be clipped or push the input around.
      className="fixed bottom-14 right-4 z-40 flex w-80 flex-col rounded-md border border-border bg-popover/95 shadow-lg backdrop-blur"
      aria-label="command parameters"
    >
      <header className="border-b border-border px-3 py-2">
        {/* The sentence, not the command name: reading back what was chosen is how you know the right row was taken. */}
        <div className="text-xs font-medium text-foreground">
          {command.readable}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {command.canonical}
        </div>
      </header>

      <div className="flex flex-col gap-1.5 px-3 py-2">
        {command.args.map((a, i) => (
          <label key={a.name} className="flex flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "font-mono text-[10px]",
                  i === active ? argColor[a.kind] : "text-muted-foreground",
                )}
              >
                {a.name}
                {/* A trailing optional says so: leaving it blank is an ANSWER, and the form would otherwise look unfinished for ever. */}
                {a.optional && (
                  <span className="ml-1 opacity-60">· optional</span>
                )}
              </span>
            </span>
            <input
              ref={i === active ? inputRef : undefined}
              value={values[i] ?? ""}
              onChange={(e) => onType(i, e.target.value)}
              onFocus={() => onFocusField(i)}
              onKeyDown={onKeyDown}
              placeholder={a.hint}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                "w-full rounded border bg-background/60 px-2 py-1 font-mono text-xs outline-none",
                i === active
                  ? `border-primary/60 ${argColor[a.kind]}`
                  : "border-border text-foreground/80",
              )}
            />
          </label>
        ))}
      </div>

      {suggestions.length > 0 && (
        <ul className="max-h-48 overflow-auto border-t border-border py-1 text-xs">
          {suggestions.map((v, i) => (
            <li key={v}>
              <button
                type="button"
                // mousedown, and preventDefault: the blur that would close this list must never be the one that was about to pick from it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(v);
                }}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "w-full cursor-pointer px-3 py-0.5 text-left font-mono",
                  arg ? argColor[arg.kind] : "text-foreground",
                  i === selected && "bg-accent",
                )}
              >
                {v}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* What the two keys do, naming what Enter will do THIS press, which is not always "run" (see `enterAction`). */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        <span>Tab · next</span>
        <span className={cn(enterDoes === "run" && "text-foreground")}>
          {enterDoes === "take"
            ? "Enter · pick"
            : enterDoes === "run"
              ? "Enter · run"
              : "Enter · next missing"}
        </span>
        <span>Esc · cancel</span>
      </footer>
    </section>,
    document.body,
  );
}
