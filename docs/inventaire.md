# Inventory of dead, duplicated and built-ahead code

What the repo contains and nothing reaches. Every entry carries enough to decide: *who calls it* is
the question, not *does it work*.

> **Read §0 before deleting anything.** Several perfectly live modules are invisible to an `import`
> sweep. The trap recurs at every survey.

`npm run lint:dead` (knip, `knip.json`) does passes 1, 2 and 4 below in thirty seconds. It is
**non-blocking** — a calibration is read, not suffered — and its exception list is §0 translated
into configuration. What it does not see: the C++ (`biome.json` excludes it too) and everything §0
describes — knip believes what it is told. Its `ignoreWorkspaces` holds only `commons/`, because the
submodule carries its own docs and its own truth.

Current output: **0 files, 0 dependencies, 0 binaries, 0 exports, 0 types and 0 duplicate
exports**. On a checkout where the paraglide
catalogues have not been compiled, it also lists every `paraglide/messages.js` import as unresolved:
those files are generated, not missing.

> **A rising count can measure a `package.json` that lies less.** A symbol published in an `exports`
> map is invisible to knip, which takes it as consumed from outside; the same symbol turned internal
> becomes a plainly visible "unused export". Shrinking a published surface therefore moves findings
> out of the shadow and into the list. The count never reads alone: it reads against the `exports`
> maps of the same day.

## How this survey is made

Four passes, all reproducible:

1. **Published surface** — every subpath of every package's `exports` map, against the specifiers
   that actually appear in the source.
2. **Reachability** — a walk of the import graph from the real entry points: everything outside
   `packages/`, files reached from another package by a published specifier, the `bin`/`main`, the
   declared `entry` globs, and the tests.
3. **Config** — dependencies imported without being declared, missing scripts, environment variables
   read without being documented.
4. **Symbols** — every `export`ed name, against every identifier appearing in the other files. A name
   nothing else pronounces, not even its own file, has no possible caller left. Deliberately crude: a
   homonym saves a dead symbol, never the reverse, so the list is a floor.

**Two SURVEY traps**, about the page rather than the code:

- **A file rename stales a path without staling the finding.** An entry can be wrong twice: the
  symbol has moved file, and it has been resurrected meanwhile. Check both, separately.
- **A corrected finding does not withdraw itself.** A commit updating the prose *around* an entry
  without revisiting the entry leaves an indictment of a repo that has moved. Replaying the passes
  is the only defence.

Corollary: **`docs/audit-moteur.md` §C5 keeps its own dead-code list**, over a perimeter overlapping
this one without being identical. The two are read together, or an entry stales on both sides
without anyone seeing it.

**Three method traps:**

- **Extensions count.** An import written `from "./addresses.ts"` escapes a search on
  `"…/addresses"`, which then declares a live subpath dead.
- **A specifier does not span two lines.** Too permissive a regex catches the word `from` in prose
  and invents dozens of phantom dependencies.
- **A NUL byte makes a file INVISIBLE.** ripgrep classes any file containing one as binary and skips
  it without a word: the file stops existing for the whole reachability pass. The case arises as soon
  as a NUL is taken as a composite-key separator — the six-character escape gives the same string at
  runtime and stays visible to every tool. `npm run lint:bytes`
  (`scripts/check-source-bytes.mjs`) refuses it in CI, and only helps if it is RUN. The trap costs
  more than it looks: knip reads source the way ripgrep does, so a file carrying a NUL is invisible
  to the dead-code detector itself, which will return a perfectly false "nothing to report". **Run
  `lint:bytes` BEFORE `lint:dead`**, or the second lies about the first. (This page does not write
  the byte literally: copying it from source to describe it traps the page itself.)

---

## 0. Known false positives — do not re-kill

### Loaded by PATH, never imported

| what | how it lives |
|---|---|
| `@studio/dsp` in `@studio/song` | resolved by PATH (`require.resolve`) in `packages/song/src/compile/jsDspJail.ts`, bundled with esbuild and handed to the jailed child as a `data:` URL. The `song → dsp` dependency exists so that resolve succeeds: a song folder has no `node_modules`. |
| a library module's `jsdsp.ts` | MODULE DSPs, in a library folder rather than this tree. The compiler finds them by filename (`JSDSP_FILE = "jsdsp.ts"`), never by import, so no import sweep sees them; `knip.json` declares `k7-core/modules/**/jsdsp.ts` an entry. |
| `demos/**/jsdsp.ts` | same mechanism: a demo module's DSP is data loaded at runtime. |
| `packages/file-service/src/server.ts` | **spawned** by `packages/file-hub/instances.ts` through `tsx`, one process per account. Zero imports is not zero callers. |
| `packages/ui-chains-react/src/DomChains.stories.tsx` | picked up by `.storybook/main.ts`'s glob. |
| `packages/dsp/src/emit.ts` | the package's `build` script (`tsx src/emit.ts`). A pass looking only at `bin` and esbuild entries declares it dead; **a `package.json` `scripts` entry is a caller.** |

`@studio/dsp` is also the author-facing API published to users
(`apps/k7/docs/25-syntax-instruments.md`), and the C++ pastes its generated JSON
(`engine/k7-runtime/engine/GraphDspPlugin.cpp`).

### `detectTransients` is called once per file, by the analysis

`packages/audio-probe/src/waveform.ts` exports it and only `@studio/audio-analysis`'s `buildEnvelope`
calls it, while it builds a file's envelope; the result goes into the `{source}.cache` sidecar.
Nothing calls it per clip region, and nothing should (`packages/file-service/docs/waveformCache.md`).

### A deep import bypasses the `exports` maps

`engine/k7-runtime/scripts/render-once.ts` → `packages/file-service/src/render.ts`. The file looks
unreachable if you look only at `exports`.

### `commons/` is a submodule

The parent repo's `git ls-files` does not list it. `OIDC_ISSUER`, `GRIST_API_KEY`, `GRIST_DOC_ID` and
`BACKEND_PORT` are read there: they look unused from here, and are not.

---

## 1. Published surface with no external consumer

**6 subpaths out of 376** have no importer outside their own package. That is a finding about the
`exports` map, not about the code: all 6 are **alive inside** their package, reached by relative
import.

| package | subpath |
|---|---|
| `engine-registry` | `/advertise`, `/proxy` |
| `engine-tunnel` | `/rtc` |
| `song` | `/uiMigrate` |
| `ui-editor` | `/faust/language` |
| `project-shell` | `/files` — published, so its importer may be outside this repository |

Shrinking the map deletes nothing: it documents the real surface.

The desk (`packages/k7-plugins/src/turntables`) publishes **1** subpath, `/turntables/engine`. Its
other plumbing stays reachable by relative import inside the package.

## 2. Genuinely orphaned — nothing reaches it

| what | where | note |
|---|---|---|
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts` | the registry does this work. Deleting a loopback probe nothing replays is to be decided, not left to rot. |
| type `Signal` | `packages/dsp/src/index.ts` | `@deprecated`, not one reference left in the whole repo. |

### SYMBOLS, not files

The file lives, the function does not: nobody pronounces that name anywhere, not even the file
declaring it. From pass 4, over `apps/`, `packages/` and `engine/`; `probeLocalEngine`, above, is
not repeated. Pass 4 finds nothing else but the named stories of the `*.stories.tsx` files, which
Storybook reads by export rather than by name.

| symbol | where | note |
|---|---|---|
| types `LcdDraw`, `LcdPointer`, `PanelVisible` | `packages/ui-chains/src/lcdScreen.ts` | the contract a module's `widgets.js` is written against (`../packages/ui-chains-react/docs/lcdScreen.md`), kept for its reader: a `widgets.js` is plain JavaScript, so no file in the tree names them. |

**A further ~480 symbols are pronounced only by their own test.** That is not dead code — it is the
choice, taken everywhere here, of testing a constant or a computation step rather than the single
public function wrapping them. Counted so the figure does not surprise the next pass:
`ui-chains/src/cableCanvas.ts` (13), `song-schema/src/trackKind.ts` (7), `dsp/src/sweep.ts` (6).

**Tooling with no entry point** — programs, not dead code, but nothing wires them:

- `packages/song/scripts/` — run by hand, apart from `checkPanelBinds.ts`, which is `npm run lint:panels`.
  `projectFingerprint.ts` records what a
  real project compiles to, to diff before and after a refactor.
- `packages/k7-plugins/scripts/turntables/put-on.ts` — this one is **documented** and run by hand
  (`../packages/k7-plugins/docs/turntables/hosting.md`); it measures a SOUND, which no unit test does.

## 3. Built ahead — not to be confused with an oversight

### Asking a plugin what it has

The full chain is alive: `App.tsx` (`onScanParams={api.scanPluginParams}`) → `api.ts`
(`GET /plugin-params`) → `file-service/src/routes/accountRoutes.ts` → `awaitPluginParams`
(`enginePluginQueries.ts`) → `listPluginParams` →
`list-plugin-params` → `pluginParamsOf` (`engine/k7-runtime/engine/ParamDump.cpp`). What has no caller is
the **browser half** only: `listPluginParams` (`engine-browser/src/engineQueries.ts`) and
`onPluginParamList` (`engine-browser/src/engineEvents.ts`).

Two reasons to keep the whole. It is the **only** way to learn an installed plugin's parameters — a
plugin registers them in its constructor, and the scan cache carries none. And three real failures
are legible in it: the engine rebuilt a `te::Engine` per question and forty questions in a row killed
it (measured, twice); it asked a plugin for its list before the asynchronous load had built it; and an
empty list confuses "I cannot load this plugin" with "it loads and publishes none".

That last point stands on its own: **a plugin with no parameter is almost always a plugin refusing to
load** (`getLoadError` says so, if asked). Answering "this synth has no parameters" states a fact
about the plugin where it is a fact about the machine — a licence, an installation — and sends nobody
to the only place it is fixable.

A panel generator derived from a parameter list can only produce buttons and dropdowns — never a
fader, a `meter`, a file picker or a layout. What would relight the browser half: a module builder
offering the list of a VST's parameters to bind.

## 4. Duplication

### A MIDI note's name, five times, in four spellings

The same chromatic table and the same arithmetic (`((k%12)+12)%12`, `Math.floor(k/12)-1`):

| where | constant |
|---|---|
| `packages/ui-editor/src/tracker/RollGrid.ts` | `NOTE_NAMES` |
| `packages/ui-editor/src/tracker/TrackerGrid.ts` | `NAMES2` (two characters: `C-`) |
| `apps/k7/frontend/src/noteNames.ts` | `NAMES`, behind `noteName` |
| `packages/ui-rehearsal/src/utils/pitch.ts` | `NOTE_NAMES` |
| `packages/lyrics/src/chords.ts` | `SHARP` |

Two aggravating details. The first two are in **the same folder of the same package**. And
`noteNames.ts` calls itself "one spelling of a MIDI key, for every view" — true within k7,
false the moment you step into `@studio/ui-editor`, which k7 already depends on and which has two of
its own. The predicate follows: `isBlack = [1,3,6,8,10].includes(...)`, identical in two files.

Not addressed: it is a decision about **where to put the table**, not a cleanup.

### STRUCTURAL copies — the ones an import cannot resolve

A duplication that cannot be removed without inverting a dependency or poisoning a bundle.
Written here so it stops being mistaken for laziness.

| what is doubled | why it stays |
|---|---|
| The `-100 dBFS` floor: `PEAK_FLOOR_DB` (`audio-analysis/src/peak.ts`), `MIN_DB` (`audio-probe/src/trimGate.ts`), and three times in `@studio/dsp` | `trimGate` is **browser-safe** — k7's clip panel imports it — and `peak.ts` spawns a decoder. Sharing the constant would bring a process launcher into the browser to save one number. The generated JSON cannot import at all |

### Cosmetic, but real

- **The `piano-16` glyph**, SVG body identical byte for byte:
  `apps/k7/frontend/src/trackIcons.tsx` ≡ `packages/ui-chains-react/src/moduleIcons.tsx`.
  (The rest of the glyph-table duplication is argued and accepted — see `moduleIcons.tsx`.)
- **The full-screen spinner**, three copies of the same block here:
  `apps/k7/frontend/src/components/{AuthGate,EngineGate}.tsx` and
  `packages/project-shell/src/GateScreens.tsx`. Left as is: short presentation blocks, no risk of silent drift — but
  one grows per gate, which makes this count a thing to re-check.

### Left on purpose

`AuthUser` is declared twice: `@frediverse/http`'s, which k7's backend widens with `groups`
(`apps/k7/backend/src/types/express.d.ts`), and k7's frontend's own in `api.ts`, the only one
carrying `email?: string | null`.

## 5. Config

| finding | where |
|---|---|
| With no test file at all: `graph-model`. | — |
| Read in code and absent from **every** `.md`: `STUDIO_MODELS`, `STUDIO_SCRATCH`, `CHROME`. | `packages/song/src/modelCache.ts`, `engine/k7-runtime/scripts/` |
| Imported without being declared: `ui-chains-react`, `ui-rehearsal`, `score` and `k7-plugins` (`@storybook/react-vite`, in their `*.stories.tsx`; the root declares it). | — |
| `packages/web-protocol` depends on `@studio/engine-protocol` alone, which has no dependency of its own, and that is RIGHT — what it takes from it is types. That absence of a runtime dependency is what lets `engine-client` take it to read `ENGINE_OUTBOX_MAX` without weighing down the supervisor's bundle. | `packages/web-protocol` |
| Read in code, absent from `env.example.yaml`: `STUDIO_REGISTRY_URL`, `STUDIO_DEMOS`, `STUDIO_MODELS`, `STUDIO_WEB_PORT`, `STRUDEL_SAMPLES`, `DIRT_SAMPLES`, `STUDIO_ENGINE_TOKEN`, `STUDIO_SCRATCH`, `K7_URL`, `K7_TOKEN`, `MPV_BIN`, `CHROME`. | `env.example.yaml` |

## 6. A deck has no effects chain

Mix is a desk: two records and a crossfader. A deck's effects chain has no place on it, and the
desk's only host (k7's `turntables` surface) draws no per-deck graph, so there is no component for
one: an option nothing can mount would cost code and a published subpath that lies about the
package's surface. See
[../packages/k7-plugins/docs/turntables/mix.md](../packages/k7-plugins/docs/turntables/mix.md).

One leftover name: `m9`, an application that does not exist, is a session id in the
`SessionRegistry_test.cpp` fixtures — any string would do there.

> **A test file does not die with its subject; its tests die one by one.** A test file named after
> a module regularly covers another one through a shared helper: a `describe` about one component
> can hold tests of `deckDoc` — `deck.ts`, very much alive — the module order (audible), the wire
> form of `plugin:`, the bypass. Deleting the file "because it tests dead code" would lose them
> silently. Those live in `deck.test.ts`, under "a deck's modules, in the document".
