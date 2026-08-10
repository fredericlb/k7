// CommandBar.tsx — the command palette. It asks ONE question: what do you want done. You
// answer in your own words, it lists SENTENCES, and the command's parameters are asked
// afterwards in their own panel (CommandParams). See docs/commandBar.md.
//
// Both halves match the same way, with the shell's one fuzzy matcher: the command list against
// each command's readable description AND its name, a field's list against that param's whole
// vocabulary. Nothing here matches by prefix — "rythm" has to find `ge.rythm`, and "mute a
// track" has to find `track mute`. Commands you have run lately are nudged up the list
// (recentCommands.ts), and nothing is listed at all until a character is typed.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  applyOffer,
  canRun,
  emptyValues,
  firstMissing,
  lineArgs,
  nextField,
  wantsKind,
} from "../commandFill";
import { rankCommands, rankValues } from "../palette";
import { recentCommands } from "../recentCommands";
import type { ArgClass } from "../types";
import { CommandParams } from "./CommandParams";

// A command the palette can build: its canonical name, a joined display label, each translation,
// the sentence it is listed by, and its params.
export interface PaletteCommand {
  canonical: string;
  label: string;
  names: string[];
  /** What it DOES, in the reader's language — see palette.ts. Never empty. */
  readable: string;
  args: PaletteArg[];
}

// A param the form asks for: its name, the KIND of thing it names, and one line on what it accepts.
export interface PaletteArg {
  name: string;
  kind: ArgClass;
  hint: string;
  // Trailing params the line runs without — see requiredCount. Left blank, they are an answer.
  optional?: boolean;
}

// What the bar is filling right now, so the shell can point a gesture at the field waiting for it.
export interface CommandPending {
  canonical: string;
  wants: string; // the param's name
  kind: ArgClass;
}

// One colour per param kind, so a form reads as coloured questions: project-owned things cool,
// typed literals warm, a fixed word set between. Exhaustive over ArgClass, so a new kind can't
// ship uncoloured.
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
   * Fill the ACTIVE field from a gesture that knows a value and not a command — a click on the
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
    /** One param's WHOLE vocabulary, given the params before it; the ranking happens here. */
    listArg: (command: string, priorArgs: string[]) => Promise<string[]>;
    onRun: (line: string) => void; // the assembled canonical command line
    onClose?: () => void;
    autoFocus?: boolean;
    // Which field is waiting, so the shell can route a gesture to it (null between commands).
    onPending?: (p: CommandPending | null) => void;
  }
>(function CommandBar(
  { commands, listArg, onRun, onClose, autoFocus, onPending },
  ref,
) {
  const [value, setValue] = useState("");
  const [command, setCommand] = useState<PaletteCommand | null>(null);
  // One slot per param, "" meaning unanswered — a form, not a queue. See commandFill.ts.
  const [values, setValues] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  // The active field's WHOLE vocabulary, fetched once per field and ranked here on every
  // keystroke. One round trip per question instead of one per letter, and a fuzzy match.
  const [vocab, setVocab] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  // Whether the command list is on screen at all. It has to be FOCUS, not "are there
  // suggestions": the bar is docked and always mounted, and the catalogue is non-empty from the
  // moment it loads — so anything else leaves 30 rows hanging over the minimap for ever.
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); // the command field
  const argRef = useRef<HTMLInputElement>(null); // the form's active field
  const selRef = useRef<HTMLLIElement>(null); // the highlighted row, to keep it in view
  const latest = useRef(0); // guard against out-of-order async vocabularies

  const arg = command ? (command.args[active] ?? null) : null;
  // NOTHING is listed until a character is typed. The catalogue is ninety rows: opening on the
  // whole of it puts a wall over the minimap every time the bar takes the focus, and a list you
  // did not ask for is a list you have to dismiss. One letter is the whole cost of asking.
  const query = command ? "" : value.trim();
  const matches = query ? rankCommands(commands, value, recentCommands()) : [];
  // The form's own typing goes in its field, so the bar's query is only ever the command's.
  const suggestions = command ? rankValues(vocab, values[active] ?? "") : [];
  const list: readonly unknown[] = command ? suggestions : matches;
  const selIdx = list.length
    ? ((sel % list.length) + list.length) % list.length
    : 0;

  const reset = () => {
    setCommand(null);
    setValues([]);
    setActive(0);
    setValue("");
    setVocab([]);
    setSel(0);
  };

  // Enter the form: fresh answers, first field, and the focus follows the question.
  const start = (spec: PaletteCommand, seed: string[] = []) => {
    const vals = emptyValues(spec.args);
    seed.slice(0, spec.args.length).forEach((v, i) => {
      vals[i] = v;
    });
    setCommand(spec);
    setValues(vals);
    // Open on the first thing still missing, so a pre-written line lands on what it left out.
    setActive(Math.max(0, firstMissing(spec.args, vals)));
    setValue("");
    setSel(0);
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The form's active field takes the keyboard whenever it changes — that is what makes Tab
  // "go to the next question" rather than "move to the next DOM node and hope".
  useEffect(() => {
    if (command) argRef.current?.focus();
  }, [command, active]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => (command ? argRef : inputRef).current?.focus(),
      blur: () => (command ? argRef : inputRef).current?.blur(),
      prewrite: (text: string) => {
        // The longest head — canonical or translated — that prefixes the line; anything trailing becomes param values.
        let best: { spec: PaletteCommand; head: string } | null = null;
        for (const c of commands)
          for (const head of [c.canonical, ...c.names])
            if (
              (text === head || text.startsWith(`${head} `)) &&
              (!best || head.length > best.head.length)
            )
              best = { spec: c, head };
        if (best) {
          start(best.spec, splitArgs(text.slice(best.head.length).trim()));
          return;
        }
        reset();
        setValue(text);
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        requestAnimationFrame(() =>
          el.setSelectionRange(el.value.length, el.value.length),
        );
      },
      offer: (offered: Record<string, string>, live = false) => {
        // No command picked yet means no field to write to: a gesture cannot choose the verb.
        if (!command) return;
        const next = applyOffer(command.args, offered, values, active);
        if (!next) return;
        setValues(next.values);
        setActive(next.active);
        setSel(0);
        if (!live) argRef.current?.focus();
      },
      offerValue: (kind: ArgClass, v: string, live = false) => {
        if (!command || !wantsKind(command.args, active, kind)) return;
        setValues((cur) => cur.map((x, i) => (i === active ? v : x)));
        setSel(0);
        if (!live) argRef.current?.focus();
      },
    }),
    [commands, command, values, active],
  );

  // Say which field is waiting. The shell routes gestures by this, so it must also say "none"
  // when the form closes — a stale pending would keep a drag feeding a command that is gone.
  useEffect(() => {
    onPending?.(
      command && arg
        ? { canonical: command.canonical, wants: arg.name, kind: arg.kind }
        : null,
    );
    return () => onPending?.(null);
  }, [command, arg, onPending]);

  // The active field's vocabulary — fetched when the FIELD changes, not when it is typed into.
  useEffect(() => {
    if (!command) {
      setVocab([]);
      return;
    }
    const id = ++latest.current;
    setVocab([]);
    listArg(command.canonical, values.slice(0, active))
      .then((vals) => {
        if (latest.current === id) setVocab(vals);
      })
      .catch(() => {});
    // Deliberately NOT on `values`: re-fetching on every keystroke is what this replaced. The
    // prior args are read at fetch time, which is what a later field's vocabulary depends on.
  }, [command, active, listArg]);

  // Keep the highlighted row on screen — an unseen selection can't be trusted.
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  const runNow = (vals: readonly string[]) => {
    onRun(
      [command!.canonical, ...lineArgs(vals).map(quoteArg)].join(" ").trim(),
    );
    reset();
  };

  // --- the command field -------------------------------------------------------

  const pickCommand = (spec: PaletteCommand) => {
    if (spec.args.length === 0) {
      onRun(spec.canonical); // nothing to ask — run at once
      reset();
      return;
    }
    start(spec);
  };

  const commitCommand = () => {
    if (matches.length) {
      pickCommand(matches[selIdx]);
      return;
    }
    // Nothing matched: run the line as typed. That is the CLI road, and it is how a command
    // with its arguments already on it — pasted, or recalled — dispatches without a form.
    const typed = value.trim();
    if (!typed) return;
    onRun(typed);
    reset();
  };

  // --- the parameter form ------------------------------------------------------

  const setField = (i: number, v: string) => {
    setValues((cur) => cur.map((x, k) => (k === i ? v : x)));
    setSel(0);
  };

  const takeSuggestion = (v: string) => {
    setField(active, v);
    setVocab((cur) => cur); // keep the vocabulary; only the query changed
  };

  const onFormKey = (e: React.KeyboardEvent) => {
    if (!command) return;
    if (e.key === "Tab") {
      e.preventDefault();
      // A highlighted suggestion is taken first — completion is still the validation — and the
      // same key then steps to the next question.
      if (suggestions.length) takeSuggestion(suggestions[selIdx]);
      setActive((i) => nextField(command.args, i));
      setSel(0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length) {
        takeSuggestion(suggestions[selIdx]);
        return;
      }
      const missing = firstMissing(command.args, values);
      if (canRun(command.args, values)) runNow(values);
      else if (missing >= 0) {
        setActive(missing);
        setSel(0);
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (suggestions.length) {
        e.preventDefault();
        setSel((i) => (e.key === "ArrowDown" ? i + 1 : i - 1));
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // First Esc drops the list, a second abandons the command — the deliberate way out.
      if (suggestions.length) setVocab([]);
      else {
        reset();
        inputRef.current?.focus();
      }
    }
  };

  return (
    <div className="relative flex flex-1 items-center">
      <span className="mr-1 font-mono text-sm text-primary">❯</span>
      {command ? (
        // While the form is open the bar shows WHAT is being filled, and takes no typing: the
        // questions have their own fields, and a second input here would compete for the keys.
        <button
          type="button"
          onClick={() => {
            reset();
            inputRef.current?.focus();
          }}
          className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground hover:text-foreground"
          title="click to pick another command"
        >
          {command.readable}
          <span className="ml-2 font-mono text-xs opacity-60">
            {command.canonical}
          </span>
        </button>
      ) : (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSel(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              commitCommand();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              // The list renders bottom-first (it opens upward), so ↑ walks FORWARD through it.
              if (matches.length) {
                e.preventDefault();
                setSel((i) => (e.key === "ArrowUp" ? i + 1 : i - 1));
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue("");
              onClose?.();
            }
          }}
          placeholder="what do you want to do?"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      )}

      {!command && focused && matches.length > 0 && (
        // Opens UPWARD and lists bottom-first, so the best match sits right above the input.
        <ul className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-72 flex-col-reverse overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md">
          {matches.map((c, i) => (
            <li
              key={c.canonical}
              ref={i === selIdx ? selRef : undefined}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus
                pickCommand(c);
              }}
              onMouseEnter={() => setSel(i)}
              className={`flex shrink-0 cursor-pointer items-baseline justify-between gap-4 px-3 py-0.5 ${i === selIdx ? "bg-accent" : ""}`}
            >
              {/* The sentence leads, because it is what was searched for; the name follows in
                  the corner, where a keybinding sits in every palette you have used. */}
              <span className="min-w-0 truncate text-foreground">
                {c.readable}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {c.canonical}
              </span>
            </li>
          ))}
        </ul>
      )}

      {command && (
        <CommandParams
          command={command}
          values={values}
          active={active}
          suggestions={suggestions}
          selected={selIdx}
          argColor={ARG_COLOR}
          runnable={canRun(command.args, values)}
          onType={setField}
          onFocusField={(i) => {
            setActive(i);
            setSel(0);
          }}
          onPick={takeSuggestion}
          onHover={setSel}
          onKeyDown={onFormKey}
          inputRef={argRef}
        />
      )}
    </div>
  );
});
