// CommandParams.tsx — the parameter form, as ONE row in the bar's own place: the command, then a field per param.
//
// Every question is on screen at once, so an answer given three fields ago can be changed without
// unwinding the ones after it; a field's suggestions open upward from the row, as the command list does.
//
// It holds NO state: CommandBar owns the command, the answers and the gesture inlets, and two
// copies of that would be two commands. See docs/commandBar.md.

import { cn } from "@frediverse/ui/lib/utils";
import type { EnterAction } from "../commandFill";
import type { ArgOption } from "../palette";
import type { ArgClass } from "../types";
import type { PaletteArg, PaletteCommand } from "./CommandBar";

/** A field's width in characters: what it holds, else its placeholder, so the row reads like the line it builds. */
const fieldSize = (value: string, hint: string): number =>
  Math.max(3, Math.min(32, (value || hint).length + 1));

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
  onRepick,
  inputRef,
}: {
  command: PaletteCommand;
  values: readonly string[];
  active: number;
  /** The active field's vocabulary, already ranked — empty when it has none. */
  suggestions: readonly ArgOption[];
  selected: number;
  argColor: Record<ArgClass, string>;
  /** What Enter will do THIS press, so the row can name it — see `enterAction`. */
  enterDoes: EnterAction["kind"];
  onType: (index: number, value: string) => void;
  onFocusField: (index: number) => void;
  onPick: (value: string) => void;
  onHover: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** The command's name was clicked: drop it and pick another. */
  onRepick: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const arg: PaletteArg | undefined = command.args[active];
  const picked = suggestions.find((o) => o.value === (values[active] ?? ""));

  return (
    <div className="flex h-5 min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {/* The NAME, which is the line being built; the sentence is its title, reading back what was chosen. */}
      <button
        type="button"
        onClick={onRepick}
        className="h-5 shrink-0 font-mono text-sm leading-5 text-foreground hover:text-primary"
        title={`${command.readable} — click to pick another command`}
      >
        {command.canonical}
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {command.args.map((a, i) => (
          <input
            key={a.name}
            ref={i === active ? inputRef : undefined}
            value={values[i] ?? ""}
            onChange={(e) => onType(i, e.target.value)}
            onFocus={() => onFocusField(i)}
            onKeyDown={onKeyDown}
            // The param's name is the placeholder, a trailing optional marked so: leaving it blank is an ANSWER.
            placeholder={a.optional ? `${a.name}?` : a.name}
            size={fieldSize(values[i] ?? "", a.name)}
            title={
              i === active && picked?.label
                ? `${a.name}: ${picked.label}`
                : (a.hint ?? a.name)
            }
            spellCheck={false}
            autoComplete="off"
            className={cn(
              // h-5, the bar input's own line: a field any taller makes the whole strip jump when a command is picked.
              "h-5 shrink-0 rounded border bg-background/60 px-1.5 py-0 font-mono text-xs leading-none outline-none focus:border-primary placeholder:text-muted-foreground/60",
              i === active
                ? `border-primary/60 ${argColor[a.kind]}`
                : "border-border text-foreground/80",
            )}
          />
        ))}
      </div>
      {/* What Enter does THIS press, which is not always "run" (see `enterAction`). */}
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] text-muted-foreground",
          enterDoes === "run" && "text-foreground",
        )}
      >
        {enterDoes === "take"
          ? "↵ pick"
          : enterDoes === "run"
            ? "↵ run"
            : "↵ next"}
      </span>

      {suggestions.length > 0 && (
        // Opens UPWARD and lists bottom-first, as the command list does, so the best value sits right above the row.
        <ul className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-72 flex-col-reverse overflow-auto rounded-md border border-border bg-popover py-1 text-xs shadow-md">
          {suggestions.map((o, i) => (
            <li
              key={o.value}
              ref={
                i === selected
                  ? (el) => el?.scrollIntoView({ block: "nearest" })
                  : undefined
              }
            >
              <button
                type="button"
                // mousedown, and preventDefault: the blur that would close this list must never be the one that was about to pick from it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(o.value);
                }}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  "w-full cursor-pointer px-3 py-0.5 text-left font-mono",
                  arg ? argColor[arg.kind] : "text-foreground",
                  i === selected && "bg-accent",
                )}
              >
                {/* A labelled option is LISTED by its label and inserts its value, which a person cannot read (commands/docs/completions.md). */}
                {o.label ?? o.value}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
