# k7x — the language

The text format of a workspace's files, `.k7x`. It reads like a Strudel pattern and holds exactly
what YAML held: maps with string keys, lists, strings, numbers, booleans and null. The grammar is
`src/parse.ts`; this page is why it is shaped the way it is. The migration it belongs to is
[k7x-plan.md](../../../docs/k7x-plan.md).

```js
// nodes/synth-pad.k7x
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40, // darker than the lead…
  Level: -12,
})
automations([])
```

## Parsed, never evaluated

A k7x file looks like code and is data. Nothing runs it: no `eval`, no QuickJS, no sandbox. Three
things force that, and each would break the day a file could compute:

- **The UI writes these files.** A knob drag sets one literal at one key path and leaves every other
  byte alone (`src/edit.ts`). A value that comes out of an expression has no literal to set.
- **live-sync replays edits as values at key paths** (`packages/live-sync/docs/ops.md`). An
  expression has no path to replay into.
- **The server reads files other accounts wrote** — libraries, shares. Reading data is safe;
  running it is not.

What computes stays where it already is: a `.strudel` pattern, which the engine evaluates
(`engine/st0-engine/docs/patternPlugin.md`). k7x borrows Strudel's look, not its semantics.

## A call is an entry, a chain is a map

| written | reads as |
|---|---|
| `key(v)` | the entry `key: v` |
| `a(1).b(2)` | the map `{ a: 1, b: 2 }` |
| `key()` | `key: true` — a flag, the way Strudel writes `.rev()` |
| `key(a, b)` | `key: [a, b]` — several arguments are a list |
| `{ a: 1 }` | the same map as `a(1)`, for keys that are not words |
| a file | a map: each statement contributes its entries |

A chain continues across lines when the next line starts with `.`, as in Strudel. Statements need no
separator; `;` is accepted. A key is a word (`[A-Za-z_$][A-Za-z0-9_$-]*`, dashes included, because
node names have them) or a quoted string (`"Filter Freq"(40)`, `"pad#midi": […]`). Reserved words are
ordinary keys: `extends(…)` is in almost every module file.

Two spellings of one map is deliberate. A chain reads like a pattern where the keys are a fixed
vocabulary — a step, a note, a placement. An object reads better where the keys are names the
project chose — params, graph modules, widgets. Both are the same data, so a writer keeps whichever
the file already uses.

## Strings

`"…"` and `'…'` take JSON's escapes plus `\'`. A backtick string is raw and may span lines; only
`` \` `` and `\\` are escapes, and `${…}` is literal text, because nothing interpolates.

## Short forms

The language itself has none. A kind of file may: a sequence may write its notes as mini-notation,
a graph its segments as runs — read by that kind's reader into the same data
(`packages/song-schema/docs/sugar.md`). They are an authoring aid, not a second way to store data.

## Comments

`//` and `/* */`. They are trivia to the reader and untouched by every edit; the converter carries
YAML's `#` comments across as `//` (`convert.md`).

## Why a hand-written parser, and not acorn

acorn parses JavaScript, and k7x is not JavaScript: `extends("…")` is a syntax error there, and
acorn would accept everything k7x must refuse (identifiers, arithmetic, functions), leaving a second
pass to reject it. The grammar is small enough that a parser of its own is shorter than that
second pass, records exactly the spans the edits need, and reports errors in k7x's terms (line,
column, and "quote a string, or call it as foo(…)" for a bare word).

## The canonical layout

What `print.ts` writes when it writes a whole value (a new file, a new entry, a replaced value):

- the root is one statement per entry, one per line;
- a map that is a list item is a chain — `t(0).d(1).k(60)` — and a map that is an entry's value is
  an object;
- a node fits on one line up to 100 columns, else breaks one child per line with trailing commas,
  and a broken chain puts each call on its own line behind a leading `.`;
- anything carrying a comment breaks, since `//` ends its line.

The layout is only for text written whole. An edit never reformats what it does not change.

## The extension

`.k7x` and not `.k7`: "k7" already names the rehearsal recorder's publishing (`project share k7`,
the `K7_*` keys, the `k7-data` volume), and a sweep for one should not find the other.
