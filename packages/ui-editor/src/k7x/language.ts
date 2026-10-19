// language.ts (k7x) — colouring for a workspace's .k7x files, the Strudel-looking format of packages/k7x.
// A hand-written StreamLanguage, like the Faust mode: a key is the word before `(` or `:`, so a line is enough to tell.

import {
  HighlightStyle,
  StreamLanguage,
  type StringStream,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

export interface K7xState {
  /** Inside a block comment or a backtick string that has not closed yet: what a line cannot decide alone. */
  open: "block" | "raw" | null;
}

export const k7xStartState = (): K7xState => ({ open: null });

/** True when the next significant character on the line makes the token just read a KEY. */
const keyFollows = (stream: StringStream): boolean =>
  stream.match(/^\s*[(:]/, false) !== null;

/** One token; exported so it can be tested, and returning real `@lezer/highlight` tag names only. */
export function k7xToken(stream: StringStream, state: K7xState): string | null {
  if (state.open === "block") {
    if (stream.match(/.*?\*\//)) state.open = null;
    else stream.skipToEnd();
    return "comment";
  }
  if (state.open === "raw") {
    if (stream.match(/^(?:[^`\\]|\\.)*`/)) state.open = null;
    else stream.skipToEnd();
    return "string";
  }
  if (stream.eatSpace()) return null;
  if (stream.match("//")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match("/*")) {
    if (!stream.match(/.*?\*\//)) {
      state.open = "block";
      stream.skipToEnd();
    }
    return "comment";
  }
  if (stream.match("`")) {
    if (!stream.match(/^(?:[^`\\]|\\.)*`/)) {
      state.open = "raw";
      stream.skipToEnd();
    }
    return "string";
  }
  // An unterminated string colours to the end of the LINE and no further, as in the Faust mode.
  if (
    stream.match(/^"(?:[^"\\]|\\.)*("|$)/) ||
    stream.match(/^'(?:[^'\\]|\\.)*('|$)/)
  )
    return keyFollows(stream) ? "propertyName" : "string";
  if (stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/))
    return "number";
  if (stream.match(/^[A-Za-z_$][\w$-]*/)) {
    if (keyFollows(stream)) return "propertyName";
    const word = stream.current();
    if (word === "true" || word === "false") return "bool";
    if (word === "null") return "null";
    // A bare word is no value in k7x: shown as one, before the check says so.
    return "invalid";
  }
  if (stream.match(/^[()[\]{}]/)) return "bracket";
  if (stream.match(/^[.,:;]/)) return "punctuation";
  stream.next();
  return "invalid";
}

const k7x = StreamLanguage.define<K7xState>({
  name: "k7x",
  startState: k7xStartState,
  token: k7xToken,
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"', "'", "`"] },
  },
});

// The YAML mode's palette, a key taking the accent there as here.
const k7xHighlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--sh-muted-foreground)", fontStyle: "italic" },
  { tag: t.string, color: "var(--sh-green)" },
  { tag: t.number, color: "var(--sh-amber)" },
  { tag: t.bool, color: "var(--sh-amber)" },
  { tag: t.null, color: "var(--sh-amber)" },
  { tag: t.propertyName, color: "var(--sh-primary)" },
  {
    tag: t.invalid,
    color: "var(--sh-destructive)",
    textDecoration: "underline wavy",
  },
  { tag: t.bracket, color: "var(--sh-muted-foreground)" },
  { tag: t.punctuation, color: "var(--sh-muted-foreground)" },
]);

/** The language support for a .k7x project file. */
export function k7xLanguage(): Extension[] {
  return [k7x, syntaxHighlighting(k7xHighlight)];
}
