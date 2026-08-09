// CommandParams.tsx — the parameter form, as a small panel in the bottom-right corner.
//
// Picking a command asks WHAT you want done; this asks the questions that command has. It is
// deliberately a panel and not a step in the bar: every question is on screen at once, Tab
// walks between them, and an answer given three fields ago can be changed without unwinding the
// ones after it. See docs/commandBar.md.
//
// Bottom-right, small, and over nothing that is being pointed at: the bar itself is the bottom
// strip, the timeline and the graph fill the middle, and the corner is the one place a panel
// can sit while a gesture elsewhere answers one of its fields.
//
// It holds NO state. Everything lives in CommandBar, which owns the command, the answers and
// the gesture inlets — two components with two copies of that would be two commands.

import { cn } from "@frediverse/ui/lib/utils";
import { createPortal } from "react-dom";
import type { ArgClass } from "../types";
import type { PaletteArg, PaletteCommand } from "./CommandBar";

export function CommandParams({
  command,
  values,
  active,
  suggestions,
  selected,
  argColor,
  runnable,
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
  /** Whether every required field is answered, so the footer can say what Enter will do. */
  runnable: boolean;
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
      // Portalled and fixed: the bar it belongs to is a flex row in the shell's bottom strip,
      // and a panel this size inside it would either be clipped or push the input around.
      className="fixed bottom-14 right-4 z-40 flex w-80 flex-col rounded-md border border-border bg-popover/95 shadow-lg backdrop-blur"
      aria-label="command parameters"
    >
      <header className="border-b border-border px-3 py-2">
        {/* The sentence, not the command name: it is what was chosen, and reading it back is
            how you know the right row was taken. The name sits under it for the CLI-minded. */}
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
                {/* A trailing optional says so, because leaving it blank is an ANSWER and the
                    form would otherwise look unfinished for ever. */}
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
                // mousedown, and preventDefault: the blur that would close this list must never
                // be the one that was about to pick from it.
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

      {/* What the two keys do, said rather than remembered — this panel is where a person meets
          the rule that Tab is "next question" and Enter is "that is my line". */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        <span>Tab · next</span>
        <span className={cn(runnable && "text-foreground")}>
          {runnable ? "Enter · run" : "Enter · next missing"}
        </span>
        <span>Esc · cancel</span>
      </footer>
    </section>,
    document.body,
  );
}
