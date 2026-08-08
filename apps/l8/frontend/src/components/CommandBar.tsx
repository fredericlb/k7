// CommandBar.tsx — the command palette as a STEP-BY-STEP form: pick a command, then fill
// each param in turn with completion for that param. COMPLETION IS THE VALIDATION —
// where a field has suggestions, Enter/Tab take the highlighted one, so a half-typed
// command can never dispatch. See docs/commandBar.md.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  applyOffer,
  requiredCount,
  runsAfter,
  wantsKind,
} from "../commandFill";
import type { ArgClass } from "../types";

// A command the palette can build: its canonical name, a joined display label, each translation, and its params.
export interface PaletteCommand {
  canonical: string;
  label: string;
  names: string[];
  args: PaletteArg[];
}

// A param the stepper asks for: its name, the KIND of thing it names, and one line on what it accepts.
export interface PaletteArg {
  name: string;
  kind: ArgClass;
  hint: string;
  // Trailing params the line runs without — see requiredCount. Tab steps onto one, Enter runs past it.
  optional?: boolean;
}

// What the bar is filling right now, so the shell can point a gesture at the field waiting for it.
export interface CommandPending {
  canonical: string;
  wants: string; // the param's name
  kind: ArgClass;
}

// One colour per param kind, so a line reads as a coloured sentence: project-owned things cool, typed literals
// warm, a fixed word set between. Exhaustive over ArgClass, so a new kind can't ship uncoloured.
const ARG_COLOR: Record<ArgClass, string> = {
  track: "text-sky-400",
  module: "text-violet-400",
  file: "text-emerald-400",
  marker: "text-fuchsia-400",
  choice: "text-cyan-300",
  timecode: "text-amber-400",
  number: "text-orange-400",
  note: "text-rose-400",
  text: "text-foreground",
};

// The same hues at placeholder weight, written out because Tailwind only ships classes it can SEE in the source.
const ARG_PLACEHOLDER: Record<ArgClass, string> = {
  track: "placeholder:text-sky-400/50",
  module: "placeholder:text-violet-400/50",
  file: "placeholder:text-emerald-400/50",
  marker: "placeholder:text-fuchsia-400/50",
  choice: "placeholder:text-cyan-300/50",
  timecode: "placeholder:text-amber-400/50",
  number: "placeholder:text-orange-400/50",
  note: "placeholder:text-rose-400/50",
  text: "placeholder:text-muted-foreground/60",
};

// The shell focuses the bar and PRE-WRITES lines through this; prewrite parses one back into command + params.
export interface CommandBarHandle {
  focus: () => void;
  /**
   * Give the keyboard back to the editor.
   *
   * The bar is DOCKED — always on screen — so Escape can no longer mean "unmount it", and
   * leaving it focused would swallow every single-key binding (the shell's listener ignores
   * events from an input). Blurring is what "I'm done here" has to do instead.
   */
  blur: () => void;
  prewrite: (text: string) => void;
  /**
   * Fill params from a gesture elsewhere in the editor, keyed by param NAME.
   *
   * `live` means the gesture is still under the pointer: the value is shown and nothing is
   * validated, so a drag can re-offer on every frame. The closing offer (`live` false) takes
   * the focus back, because the click that started the gesture took it away and Enter has to
   * land here.
   */
  offer: (values: Record<string, string>, live?: boolean) => void;
  /**
   * Fill the OPEN field from a gesture that knows a value and not a command — a click on the
   * ruler is a timecode with no idea which param wanted one. Ignored unless that field is
   * asking for this kind, so a stray click cannot land in a field that meant something else.
   */
  offerValue: (kind: ArgClass, value: string, live?: boolean) => void;
}

// Split an argument string into tokens, honouring "double quotes" so a value with spaces stays one token.
function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

// A param value as a token: quoted when it contains whitespace, so the dispatcher reads it as one argument.
const quoteArg = (v: string) => (/\s/.test(v) ? JSON.stringify(v) : v);

export const CommandBar = forwardRef<
  CommandBarHandle,
  {
    commands: PaletteCommand[];
    // Completion for the param at `priorArgs.length` of `command`, given what's typed.
    completeArg: (
      command: string,
      priorArgs: string[],
      partial: string,
    ) => Promise<string[]>;
    onRun: (line: string) => void; // the assembled canonical command line
    onClose?: () => void;
    autoFocus?: boolean;
    // Which field is waiting, so the shell can route a gesture to it (null between commands).
    onPending?: (p: CommandPending | null) => void;
  }
>(function CommandBar(
  { commands, completeArg, onRun, onClose, autoFocus, onPending },
  ref,
) {
  const [value, setValue] = useState("");
  const [command, setCommand] = useState<PaletteCommand | null>(null);
  const [args, setArgs] = useState<string[]>([]);
  const [sugs, setSugs] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLLIElement>(null); // the highlighted row, to keep it in view
  const latest = useRef(0); // guard against out-of-order async completion

  const phase: "command" | "arg" = command ? "arg" : "command";
  const arg = command ? (command.args[args.length] ?? null) : null;
  // The active field's colours — the command field is neutral (it isn't a param).
  const color = arg ? ARG_COLOR[arg.kind] : "text-foreground";
  const placeholder = arg
    ? ARG_PLACEHOLDER[arg.kind]
    : "placeholder:text-muted-foreground/60";

  const reset = () => {
    setCommand(null);
    setArgs([]);
    setValue("");
    setSugs([]);
    setSel(0);
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      prewrite: (text: string) => {
        // The longest head — canonical or translated — that prefixes the line; anything trailing becomes param values.
        let best: { spec: PaletteCommand; head: string } | null = null;
        for (const c of commands)
          for (const head of [c.canonical, ...c.names])
            if (
              (text === head || text.startsWith(head + " ")) &&
              (!best || head.length > best.head.length)
            )
              best = { spec: c, head };
        if (best) {
          const vals = splitArgs(text.slice(best.head.length).trim());
          setCommand(best.spec);
          setArgs(vals.slice(0, best.spec.args.length));
          setValue("");
        } else {
          reset();
          setValue(text);
        }
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        requestAnimationFrame(() =>
          el.setSelectionRange(el.value.length, el.value.length),
        );
      },
      offer: (values: Record<string, string>, live = false) => {
        // No command picked yet means no field to write to: a gesture cannot choose the verb.
        if (!command) return;
        const next = applyOffer(command.args, values, args);
        if (!next) return;
        setArgs(next.args);
        setValue(next.value);
        // A fed value is not a completion. Leaving the list up would let Enter take a
        // suggestion instead of the value the gesture just put under the cursor.
        setSugs([]);
        setSel(0);
        if (!live) inputRef.current?.focus();
      },
      offerValue: (kind: ArgClass, v: string, live = false) => {
        if (!command || !wantsKind(command.args, args.length, kind)) return;
        setValue(v);
        setSugs([]);
        setSel(0);
        if (!live) inputRef.current?.focus();
      },
    }),
    [commands, command, args],
  );

  // Say which field is waiting. The shell routes gestures by this, so it must also say "none"
  // when the bar closes — a stale pending would keep a drag feeding a bar that is gone.
  useEffect(() => {
    onPending?.(
      command && arg
        ? { canonical: command.canonical, wants: arg.name, kind: arg.kind }
        : null,
    );
    return () => onPending?.(null);
  }, [command, arg, onPending]);

  // Completion for the active field: commands filter synchronously, params ask completeArg, debounced.
  useEffect(() => {
    const id = ++latest.current;
    if (phase === "command") {
      const q = value.trim().toLowerCase();
      // Match a partial against ANY translation, but label the row with whichever one matched.
      setSugs(
        commands
          .filter(
            (c) => !q || c.names.some((n) => n.toLowerCase().startsWith(q)),
          )
          .map((c) => c.label)
          .slice(0, 30),
      );
      setSel(0);
      return;
    }
    const t = setTimeout(
      () => {
        completeArg(command!.canonical, args, value)
          .then((vals) => {
            if (latest.current === id) {
              setSugs(vals.slice(0, 30));
              setSel(0);
            }
          })
          .catch(() => {});
      },
      value.trim() ? 100 : 0,
    );
    return () => clearTimeout(t);
    // `phase`/`command`/`args` are covered by `command` + `args` identity.
  }, [value, command, args, commands, completeArg]);

  const selIdx = sugs.length
    ? ((sel % sugs.length) + sugs.length) % sugs.length
    : 0;

  // Keep the highlighted row on screen — an unseen selection can't be trusted. `nearest` scrolls the minimum.
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [selIdx, sugs]);

  // Assemble and dispatch. Split out because three paths reach it: the last param, Enter on an
  // empty optional field, and a command with no params at all.
  const runNow = (vals: string[]) => {
    onRun([command!.canonical, ...vals.map(quoteArg)].join(" ").trim());
    reset();
  };

  // Validate `chosen` for this field: pick or run a command, or fill a param and advance (running on the last).
  // `more` is Tab rather than Enter — "there is another param I want", the one place the two keys differ.
  const commit = (chosen: string, more = false) => {
    if (phase === "command") {
      const c = chosen.trim();
      if (!c) return;
      const spec =
        commands.find(
          (x) => x.label === c || x.canonical === c || x.names.includes(c),
        ) ?? null;
      if (!spec) {
        onRun(c); // uncatalogued line — run it as typed (canonicalized by the shell)
        reset();
        return;
      }
      if (spec.args.length === 0) {
        onRun(spec.canonical); // no params — run at once
        reset();
        return;
      }
      setCommand(spec); // → param phase
      setArgs([]);
      setValue("");
      setSugs([]); // drop the command list; the first param's completions replace it
      setSel(0);
      return;
    }
    const next = [...args, chosen];
    setValue("");
    // Runnable once every REQUIRED param is in — filling the last one dispatches, which is what
    // makes a gesture-then-Enter one keystroke. Tab holds the line open for a trailing optional.
    if (runsAfter(command!.args, next.length, more)) {
      runNow(next);
    } else {
      setArgs(next);
      setSugs([]); // this param's list, gone; the next param's completions replace it
      setSel(0);
    }
  };

  // Validate from the completion: the highlighted suggestion, else the raw text on a field with no vocabulary.
  const commitCurrent = (more = false) => {
    if (sugs.length) commit(sugs[selIdx], more);
    else if (phase === "command") {
      const typed = value.trim();
      if (typed) commit(typed, more);
    } else if (
      // An EMPTY optional field with everything required already answered: the line is complete
      // as it stands, so Enter runs it rather than passing "" as that param's value.
      !more &&
      !value.trim() &&
      args.length >= requiredCount(command!.args)
    ) {
      runNow(args);
    } else commit(value, more);
  };

  const stepBack = () => {
    if (args.length > 0) {
      setValue(args[args.length - 1]);
      setArgs(args.slice(0, -1));
    } else if (command) {
      setValue(command.names[0]); // the active-locale name, so the list re-filters to it
      setCommand(null);
      setArgs([]);
    }
  };

  return (
    <div className="relative flex flex-1 items-center">
      <span className="mr-1 font-mono text-sm text-primary">❯</span>
      {command && (
        // The command + params filled so far — the growing line, before the field.
        <span className="mr-1 shrink-0 whitespace-nowrap font-mono text-sm">
          <span className="text-muted-foreground">{command.names[0]}</span>
          {args.map((a, i) => (
            // A filled param keeps its kind's colour, so the line so far reads as a sentence rather than one flat colour.
            <span
              key={i}
              className={ARG_COLOR[command.args[i]?.kind ?? "text"]}
            >
              {" "}
              {a}
            </span>
          ))}
        </span>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Both validate from the completion — typing only narrows, so there is no fill. They part
          // company on ONE point: Enter says "that is my line" and runs as soon as every required
          // param is in, while Tab says "there is more" and steps onto the trailing optional one.
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            commitCurrent(e.key === "Tab");
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            // The list renders bottom-first (it opens upward), so ↑ walks FORWARD through it to move visually up.
            if (sugs.length) {
              e.preventDefault();
              setSel((i) => (e.key === "ArrowUp" ? i + 1 : i - 1));
            }
          } else if (e.key === "Backspace" && value === "") {
            // Step back to the previous field rather than doing nothing.
            if (command) {
              e.preventDefault();
              stepBack();
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            // First Esc dismisses the menu, a second closes — the deliberate way out of a completion you don't want.
            if (sugs.length) setSugs([]);
            else {
              reset();
              onClose?.();
            }
          }
        }}
        placeholder={
          phase === "command" ? "command…" : `${arg?.name ?? "value"}…`
        }
        spellCheck={false}
        autoComplete="off"
        className={`min-w-0 flex-1 bg-transparent font-mono text-sm outline-none ${color} ${placeholder}`}
      />
      {arg?.hint && (
        // What the field ACCEPTS, dimmed and at the END of the row so it never pushes the caret around.
        <span
          className={`ml-3 hidden shrink-0 truncate font-mono text-xs opacity-60 sm:block ${color}`}
        >
          {arg.hint}
        </span>
      )}

      {sugs.length > 0 && (
        // Opens UPWARD and lists bottom-first, so suggestion 0 — the default — sits right above the input.
        <ul className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-72 flex-col-reverse overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md">
          {sugs.map((s, i) => (
            <li
              key={s}
              ref={i === selIdx ? selRef : undefined}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus
                commit(s);
              }}
              onMouseEnter={() => setSel(i)}
              // Suggestions wear the colour of the field they'd fill; the highlight is background only, so the hue survives.
              className={`shrink-0 cursor-pointer px-3 py-0.5 font-mono ${color} ${i === selIdx ? "bg-accent" : ""}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
