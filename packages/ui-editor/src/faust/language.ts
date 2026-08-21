// language.ts (faust) — colouring for a module's `dsp.dsp`, the source the engine compiles.
//
// A hand-written StreamLanguage rather than a grammar: `@codemirror/language` is already here and
// a Faust parser package is not, so this buys the whole of what an editor needs — comments,
// strings, numbers, the reserved words and the composition operators — for one file and no
// dependency. What it deliberately does NOT do is understand the language: no folding by block,
// no completion, no error marks. What a `.dsp` is here: packages/song/docs/faustModules.md.

import {
  HighlightStyle,
  StreamLanguage,
  type StringStream,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/** The reserved words — what the language is made of, as opposed to what a library offers. */
const KEYWORDS = new Set([
  "import",
  "declare",
  "library",
  "component",
  "environment",
  "ffunction",
  "fconstant",
  "fvariable",
  "with",
  "letrec",
  "where",
  "case",
  "process",
  "int",
  "float",
  "seq",
  "par",
  "sum",
  "prod",
  "route",
  "waveform",
  "soundfile",
  "select2",
  "select3",
  "attach",
  "inputs",
  "outputs",
]);

/**
 * The UI primitives — the ones that DECLARE a parameter.
 *
 * Coloured apart from the rest on purpose: in this repo they are the module's controls, the names
 * a `module.yaml` has to agree with and that nothing checks (packages/song/docs/faustModules.md).
 * Making them stand out is the cheapest help an editor can give on that.
 */
const UI = new Set([
  "hslider",
  "vslider",
  "nentry",
  "button",
  "checkbox",
  "hbargraph",
  "vbargraph",
  "hgroup",
  "vgroup",
  "tgroup",
]);

export interface FaustState {
  /** Inside a block comment that has not closed yet — the one thing a line cannot decide alone. */
  block: boolean;
}

export const faustStartState = (): FaustState => ({ block: false });

/**
 * One token, and the whole of the language.
 *
 * Exported so it can be TESTED: nothing in this repo mounts an editor, and driving this against a
 * `StringStream` is the only way to prove the tokens without one. It is also this file's real
 * content — everything below is wiring and colour.
 *
 * The names returned are `@lezer/highlight` tag names, and only real ones: `StreamLanguage` looks
 * each up and warns to the console for anything it does not know, which is a typo that costs the
 * colour and says so nowhere anybody is looking.
 */
export function faustToken(
  stream: StringStream,
  state: FaustState,
): string | null {
  if (state.block) {
    if (stream.match(/.*?\*\//)) state.block = false;
    else stream.skipToEnd();
    return "comment";
  }
  if (stream.eatSpace()) return null;
  if (stream.match("//")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match("/*")) {
    // Closed on the same line or not: the state is what carries it to the next one.
    if (stream.match(/.*?\*\//)) state.block = false;
    else {
      state.block = true;
      stream.skipToEnd();
    }
    return "comment";
  }
  // An unterminated string still colours to the end of the LINE and no further: a half-typed one
  // must not turn the rest of the file green the moment you open a quote.
  if (stream.match(/^"(?:[^"\\]|\\.)*("|$)/)) return "string";
  if (stream.match(/^\d+\.?\d*(?:[eE][-+]?\d+)?/)) return "number";
  if (stream.match(/^\.\d+(?:[eE][-+]?\d+)?/)) return "number";
  // A library's short name, and only when a `.` and a name follow: `os.osc`, `ve.moog_vcf`. The
  // member after the dot falls through to the identifier rule below, which is what we want — the
  // interesting half is knowing you are looking at stdfaust rather than at a local definition.
  if (stream.match(/^[a-z]{2,4}(?=\.[A-Za-z_])/)) return "namespace";
  // `_` ALONE is the wire, and it has to be caught before the identifier rule below — which
  // would otherwise swallow it, since `_` is also a legal first character of a name. `_foo` is
  // a name and stays one; that is the whole of what the lookahead says.
  if (stream.match(/^_(?!\w)/)) return "operator";
  if (stream.match(/^[A-Za-z_]\w*/)) {
    const word = stream.current();
    if (KEYWORDS.has(word)) return "keyword";
    if (UI.has(word)) return "macroName";
    return "variableName";
  }
  // The composition operators FIRST, and longest first (`<:` and `:>` before `:`), because they
  // ARE the language: a Faust program is a diagram, and these are its wires.
  if (stream.match(/^(<:|:>|:|~|,)/)) return "operator";
  // …then the ones that act on a signal: delay, cut, and the one-sample-ago quote. (The wire,
  // `_`, is caught above — it has to beat the identifier rule.)
  if (stream.match(/^[@!']/)) return "operator";
  if (stream.match(/^[-+*/%^<>=&|]+/)) return "operator";
  if (stream.match(/^[()[\]{}]/)) return "bracket";
  if (stream.match(/^[;.]/)) return "punctuation";
  stream.next();
  return null;
}

const faust = StreamLanguage.define<FaustState>({
  name: "faust",
  startState: faustStartState,
  token: faustToken,
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});

// The same palette the YAML mode uses, so one editor does not change colour vocabulary with the
// tab. The accent goes to the UI primitives here, for the reason stated on `UI` above.
const faustHighlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--sh-muted-foreground)", fontStyle: "italic" },
  { tag: t.string, color: "var(--sh-green)" },
  { tag: t.number, color: "var(--sh-amber)" },
  { tag: t.keyword, color: "var(--sh-primary)" },
  { tag: t.macroName, color: "var(--sh-primary)" },
  { tag: t.namespace, color: "var(--sh-green)" },
  { tag: t.operator, color: "var(--sh-amber)" },
  { tag: t.bracket, color: "var(--sh-muted-foreground)" },
  { tag: t.punctuation, color: "var(--sh-muted-foreground)" },
]);

/** The language support for a module's Faust source. */
export function faustLanguage(): Extension[] {
  return [faust, syntaxHighlighting(faustHighlight)];
}
