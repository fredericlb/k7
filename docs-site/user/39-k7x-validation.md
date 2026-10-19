# The k7x syntax and validation errors

## k7x

Every file of a workspace is a `.k7x` file, written in a syntax that looks like Strudel. It is
**read, never run**: nothing in it computes, and `tempo(60 * 2)` is an error, not 120.

### What k7 does with it

- Projects, libraries, modules, panels, presets and playlists are all `.k7x` files; a `.yaml` file in a
  workspace is not read. The bundled demos and the `@k7-core` library are written the same way.
- The editor highlights and completes `.k7x` files and checks them as you type.
- When k7 changes a value in a `.k7x` file (a knob, a drag on the timeline, a command), only that
  value is rewritten; comments and layout stay.
- Every file k7 creates for you is a `.k7x` file.

### Syntax

A file is a list of **calls**. Each call is a key and its value; calls may be chained with `.`, and a
chain is a map.

```js
// project.k7x
project({
  name: "My song",          // an object: { key: value, … }
  tempo: 120,
  timeSignature: "4/4",
})
markers({ "1:1": "Intro", "9:1": "Verse" })
```

| Data | k7x |
|---|---|
| a number | `tempo(120)` |
| a string | `name("Lead")` |
| a list | `layers(["main", "pip"])` |
| a map | `project({ name: "x" })` |
| a list of maps | `[ref("kick").start("1:1")]` |
| true | `video(true)` — or just `video()` |
| null | `key(null)` |

Rules:

| Element | Written |
|---|---|
| Call | `key(value)`. With no argument the value is `true`; with several, a list: `key(1, 2)` is `[1, 2]`. |
| Chain | `a(1).b(2)` is the map `{ a: 1, b: 2 }`. A chain may span lines, each line starting with `.`. |
| Key | Letters, digits, `_`, `$` and `-`, not starting with a digit; any other key is quoted: `"pad#midi": [...]`, `"Filter Freq": 90`. |
| Number | `120`, `-0.5`, `1e3`. |
| String | `"…"` or `'…'`, with JSON escapes plus `\'`; on one line. |
| Multi-line string | `` `…` `` — raw text, only `` \` `` and `\\` escaped. |
| List | `[a, b, c]`, trailing comma allowed. |
| Object | `{ key: value, … }`, trailing comma allowed. |
| Booleans, null | `true`, `false`, `null`. |
| Comments | `// to the end of the line` and `/* … */`. |
| Separators | Calls are separated by whitespace; `;` is allowed. |

A word that is not quoted and not called is an error: write `"main"`, not `main`. A key may appear
only once per file and once per object or chain. Timecodes are strings: `start("5:1:1")`.

Two short forms exist in k7x only: `notes("c4 e4 g4")` in a sequence (see
[Clips, sequences and curves](./33-material.md#the-short-note-form-k7x-only)) and `runs([...])` in a
graph (see [Chains and the graph](./36-chains-graph.md#the-graph-layout-graphk7x-and-nodes)).

### k7x syntax errors

| Message | Cause |
|---|---|
| `expected "(" after x` | A key not followed by its call. |
| `bare word "x": quote a string, or call it as x(…)` | An unquoted word as a value. |
| `duplicate key "x"` | The same key twice in one file, object or chain. |
| `expected "," or ")"`, `expected "," or "]"`, `expected "," or "}"` | A missing comma or closing bracket. |
| `unclosed "["`, `unclosed "{"`, `unterminated string`, `unterminated comment` | Something opened and never closed. |
| `expected ":" after x` | An object entry without `:`. |
| `unknown escape \x`, `bad \u escape` | An invalid escape in a string. |
| `notes: "x" is neither a note name (c4, f#3) nor a MIDI number` | A bad short note form. |

## How k7 checks a file

Every file is checked twice:

1. **As you type**, in the editor. First its syntax (does it parse at all?), then its schema (are the
   keys known, the values of the right type and range?). Problems are underlined at their line, and
   the first one is shown in the status line.
2. **When the project compiles**, after each save. Problems that need the whole project — a reference
   to a clip that does not exist, a module that is not found, a port mismatch — are found here and
   shown as the project's errors.

The editor saves on its own about a second after you stop typing. A file that does not **parse** is
never written: it is held, with the reason shown, until it parses. A file that parses but breaks its
schema is held too if the version on disk was valid, so a half-typed value never replaces a working
file.

A `.k7x` file outside the known folders is only checked for syntax; a file that is not k7x at all
(a `.md` file, say) is not checked.

### Reading an error

A message names the place and the problem: `l.12:5 events.0.start: expected a timecode like 25:1,
8:1:2 or 8:1:2:2.120` — line 12, column 5, the `start` of the first event. Paths count list entries
from 0.

### Common schema messages

| Message | Meaning |
|---|---|
| `Unrecognized key: "x"` | A key the file kind does not have, often a typo. Keys are never silently ignored. |
| `Invalid input: expected string, received number` | Usually a timecode written as a number, `start(5)`. Quote it. |
| `expected a timecode like 25:1, 8:1:2 or 8:1:2:2.120` | A value that is not a timecode. |
| `expected seconds (0.25) or a timecode like 2:1` | A window edge that is neither. |
| `'to' must be greater than 'from'` | A backwards window. |
| `expected a time signature like 4/4` | A bad `timeSignature`. |
| `a console is @<library>/console/<system>` | A bad `console` reference. |
| `expected algo/<name>.strudel` | A bad `strudel:` path. |
| `` `min` is not a toggle field — only knob, slider, fader and number carry a range `` | A widget field on the wrong widget type. |
| `a '<type>' surface draws in 'split', not in 'floating'` | A surface layout its type cannot draw. |
| `an on/off curve is 0 or 1` | An `onoff` curve point with another value. |

### Common compile messages

| Message | Meaning |
|---|---|
| `invalid module(s): …` | A node or module file failed its schema. |
| `module 'x': extends unknown module '…'` | The `extends` reference resolves to nothing; check the namespace and path. |
| `module 'x': extends '…', which …` | The module exists but its own file is broken; the rest says why. |
| `plugin "x" is not supported — it will be bypassed` | A warning: the plugin cannot be loaded here, the node passes signal through. |
| `unresolved reference(s): …` | Events naming missing material or files; see [Lanes and events](./34-lanes-events.md#errors-you-may-see). |
| `invalid chains: …` | A chain file broke its rules; see [Chains and the graph](./36-chains-graph.md#errors-you-may-see). |
| `invalid video track(s): …` | A picture lane failed its schema. |
| `timeSignature must look like '4/4'` | A bad metre in an older single-file song. |
