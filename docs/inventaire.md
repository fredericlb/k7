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

Current output: **1 file, 1 undeclared dependency, 2 undeclared binaries, 120 exports and 45 types**
— 169 findings.

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
   tray's esbuild entries, and the tests.
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

- **Extensions count.** `engine-host` writes `from "./addresses.ts"`. A search on `"…/addresses"`
  misses it and declares five of its six subpaths dead — all of them live.
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
| `packages/song/src/dspRunner.mjs` | launched as a **child process** by `nodeProject.ts`. It does `import { graph } from "@studio/dsp"`, and the `song → dsp` dependency exists precisely so that import resolves: a song folder has no `node_modules`. |
| `packages/dsp/modules/{normalize,sweep}/jsdsp.ts` | MODULE DSPs. The compiler finds them by filename (`JSDSP_FILE = "jsdsp.ts"`), never by import. |
| `songs/**/jsdsp.ts` | same mechanism: a demo song's DSP is data loaded at runtime. |
| `packages/stem-separation/src/separateWorker.ts` | launched by `separateJobs.ts` via `new URL("./separateWorker.ts", import.meta.url)`. |
| `packages/engine-host/src/cli.ts`, `packages/file-service/src/server.ts` | **esbuild entries** of `apps/studio-desktop/scripts/stage.mjs`, which bundles them into the application. Zero imports is not zero callers. |
| `packages/ui-chains-react/src/DomChains.stories.tsx` | picked up by `.storybook/main.ts`'s glob. |
| `packages/dsp/src/emit.ts` | the package's `build` script (`tsx src/emit.ts`). A pass looking only at `bin` and esbuild entries declares it dead; **a `package.json` `scripts` entry is a caller.** |

`@studio/dsp` is also the author-facing API published to users
(`apps/st0/docs/25-syntax-instruments.md`), and the C++ pastes its generated JSON
(`engine/moteur/engine/GraphDspPlugin.cpp`).

### `detectTransients` is called by nobody, and must stay that way

`packages/audio-probe/src/waveform.ts` exports it, and no production code calls it: detection runs in
the engine, in C++ (`engine/moteur/engine/Waveform.cpp`), while it is already downsampling the audio,
and the result goes into the `{source}.cache` sidecar.

The TypeScript version is the **executable specification** the C++ copies, and `waveform.test.ts` is
the contract holding the two together — the same arrangement as `fileFingerprint` and its "MUST
match" comment.

### Two deep imports bypass the `exports` maps

`engine/moteur/scripts/list-sessions.ts` → `packages/engine-host/src/engineQueries.ts`, and
`engine/moteur/scripts/render-once.ts` → `packages/file-service/src/render.ts`. Both files look
unreachable if you look only at `exports`.

### `commons/` is a submodule

The parent repo's `git ls-files` does not list it. `OIDC_ISSUER`, `GRIST_API_KEY`, `GRIST_DOC_ID` and
`BACKEND_PORT` are read there: they look unused from here, and are not.

---

## 1. Published surface with no external consumer

**31 subpaths out of 232** have no importer outside their own package. That is a finding about the
`exports` map, not about the code: nearly all 31 are **alive inside** their package, reached by
relative import.

Shrinking the map therefore deletes almost nothing: it documents the real surface. The widest
publishers are `engine-host` (5 subpaths with no external consumer, out of 6) and `song` (5), then
four tied at 3 — `engine-browser`, `player-web`, `ui-editor`, `ui-eyes`. The "publish all of `src/`"
reflex.

`engine-host` is the case to look at: of its six subpaths, only `/webOrigins` has an external
importer (`file-service`, twice). **Not to be confused with §0's trap**: that one is about internal
imports written `from "./addresses.ts"`, extension included, and says those files are alive. They
are — inside. The two findings coexist without contradiction.

`ui-turntables` publishes **4** — `.`, `/surface`, `/engine`, `/deck-set`. Its other internal
plumbing stays reachable by relative import inside the package.

## 2. Genuinely orphaned — nothing reaches it

| what | where | note |
|---|---|---|
| `index.ts` | `packages/ui-eyes/src/` | the convenience barrel. Its own header says "the subpaths are the real API", which is exactly what callers do. **Kept** because deleting it takes `export.ts` and `FrameClock` with it — that is the WebCodecs block, a product decision. |
| `export.ts` | `packages/ui-eyes/src/` | **reachable only through the dead barrel above**: `exportScene` (the frame-by-frame WebCodecs export) is therefore reachable by nothing. No surface mounts a button for it. |
| `probeLocalEngine` | `packages/engine-browser/src/probe.ts` | the registry does this work. Deleting a loopback probe nothing replays is to be decided, not left to rot. |
| type `Signal` | `packages/dsp/src/index.ts` | `@deprecated`, not one reference left in the whole repo. |
| `rollGridPlugin` / `trackerPlugin` | `packages/ui-editor/src/tracker/plugin.ts` | the two CodeMirror extensions that replace `notes:` **in place**, in the text. The grids' only host (st0, `SeqGrid.tsx`) goes through `mountSeqGrid`, which renders the same grid in a separate container. They keep one property `mountSeqGrid` has not — the YAML envelope stays visible around the grid. |
| export `AuthUser` | `apps/pl8/frontend/src/api.ts` | used in its own file, imported by nobody: it is the `export` that is surplus. **And there is a second in the same case**: `apps/z0/editor/src/api.ts`. |

### SYMBOLS, not files

The file lives, the function does not: nobody pronounces that name anywhere, not even the file
declaring it. From pass 4; the three already described elsewhere on this page
(`probeLocalEngine`/`isReachable`, `rollGridPlugin`/`trackerPlugin`, `ChainsPanel`) are not repeated.

| symbol | where | note |
|---|---|---|
| `FrameClock` | `packages/ui-eyes/src/clock.ts` | the clock the **exporter** advances — and `export.ts` is already dead two lines above. The WebCodecs path is dead whole: the barrel, `exportScene`, and the clock driving it. To be cut in one block. |
| `isDocRef` | `packages/song-schema/src/moduleTypes.ts` | a type guard nothing interrogates any more. |
| `listAll` | `packages/mediatek/src/catalogue.ts` | |
| `PATH_SEP` | `packages/file-service/src/machinePlayer.ts` | |
| `knownPrefs` | `apps/pl8/frontend/src/prefs.ts` | |
| `requireDb`, `readRawAttachment`, `canRender` | `apps/z0/backend/src/{db,grist/load,render}.ts` | |
| `drawButton`, `drawPlayerBox`, `drawSpinner`, `drawReloadIcon` | `apps/z0/presenter/src/canvas/drawHelpers.ts` | four of the file's six drawing primitives; the presenter draws neither button nor player box. |

**A further 232 symbols are pronounced only by their own test.** That is not dead code — it is the
choice, taken everywhere here, of testing a constant or a computation step rather than the single
public function wrapping them. Counted so the figure does not surprise the next pass:
`ui-turntables/deck.ts` (10), `ui-chains/cableCanvas.ts` (9), `ui-chains/graph.ts` (9).

**Tooling with no entry point** — programs, not dead code, but nothing wires them:

- `packages/song/scripts/` — no npm script and no turbo task. Eight migrations, and
  `packages/song/src/moduleMigrate.ts` (350+ lines) exists only for `migrateModules.ts`. The folder
  grows by one migration per rename, and nothing removes them once played.
- `packages/ui-turntables/scripts/put-on.ts` — this one is **documented** and run by hand
  (`packages/ui-turntables/docs/hosting.md`); it measures a SOUND, which no unit test does.

## 3. Built ahead — not to be confused with an oversight

`packages/player-web/src/moteurPlayer.ts` and `moteurEffects.ts` have no production importer. That is
**not** an oversight: they are deliberately documented
(`packages/player-web/docs/moteurPlayer.md`) and `AGENTS.md` presents them as the seam
`@studio/player-web` carries.

Deleting them would take `@studio/engine-browser` and `@studio/engine-protocol` out of
`player-web`'s dependencies with them — they serve only those two files.

### Asking a plugin what it has

The full chain is alive: `App.tsx` (`onScanParams={api.scanPluginParams}`) → `api.ts`
(`GET /plugin-params`) → `file-service/src/server.ts` → `awaitPluginParams` → `listPluginParams` →
`list-plugin-params` → `pluginParamsOf` (`engine/moteur/engine/ParamDump.cpp`). What has no caller is
the **browser half** only: `listPluginParams` (`engine-browser/src/engine.ts`) and
`onPluginParamList`.

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

### A MIDI note's name, six times, in four spellings

The same chromatic table and the same arithmetic (`((k%12)+12)%12`, `Math.floor(k/12)-1`):

| where | constant |
|---|---|
| `packages/ui-editor/src/tracker/RollGrid.ts` | `NOTE_NAMES` |
| `packages/ui-editor/src/tracker/TrackerGrid.ts` | `NAMES2` (two characters: `C-`) |
| `apps/st0/frontend/src/components/PianoRoll.tsx` | `NAMES`, exported as `noteName` |
| `apps/st0/frontend/src/components/IoPanel.tsx` | `NOTE_NAMES` |
| `apps/k7/frontend/src/utils/pitch.ts` | `NOTE_NAMES` |
| `apps/k7/packages/lyrics/src/chords.ts` | `SHARP` |

Two aggravating details. The first two are in **the same folder of the same package**. And
`PianoRoll.tsx` carries the comment "one spelling of a key, wherever it is read" — true within st0,
false the moment you step into `@studio/ui-editor`, which st0 already depends on and which has two of
its own. The predicate follows: `isBlack = [1,3,6,8,10].includes(...)`, identical in two files.

Not addressed: it is a decision about **where to put the table**, not a cleanup.

### STRUCTURAL copies — the ones an import cannot resolve

Three duplications that cannot be removed without inverting a dependency or poisoning a bundle.
Written here so they stop being mistaken for laziness.

| what is doubled | why it stays |
|---|---|
| The `-100 dBFS` floor: `PEAK_FLOOR_DB` (`commands/peakPass.ts`), `MIN_DB` (`commands/trimGate.ts`), `kFloorDb` (`FilePeak.cpp`), and three times in `@studio/dsp` | `trimGate` is **browser-safe** — st0's clip panel imports it — and `peakPass` calls `node:child_process`. Sharing the constant would bring a process launcher into the browser to save one number. Tried, reverted. The C++ and the generated JSON cannot import at all |
| `FileEnvelope` (`commands/waveform.ts`) ≡ `Envelope` (`ui-turntables/waveform.ts`) | `ui-turntables` does not depend on `@studio/commands`. Both depend on `web-protocol`, which already holds `RegionWaveform` — that is where it would go |
| `isMouseWheel`: `ui-timeline/panZoom.ts` ≡ `ui-chains-react/camera.ts` | Telling a wheel from a trackpad — three signals (`deltaMode`, `wheelDeltaY`'s 120s, the shape of the delta), identical on both sides. Neither package can depend on the other: `ui-timeline` has **no** `@studio/` dependency and the graph would be importing a package named for the arrangement. Defensible here because **both sides are tested**, case by case. The natural home would be a DOM-gesture package that does not exist; creating one for a ten-line function is a decision, not a cleanup |

k7's detector (`apps/k7/backend/src/detect.ts`) has no twin left, but it is tested nowhere — which is
what the copies above have when they defend themselves.

### Cosmetic, but real

- **The `piano-16` glyph**, SVG body identical byte for byte:
  `apps/st0/frontend/src/trackIcons.tsx` ≡ `packages/ui-chains-react/src/moduleIcons.tsx`.
  (The rest of the glyph-table duplication is argued and accepted — see `moduleIcons.tsx`.)
- **The full-screen spinner**, five copies of the same block:
  `apps/st0/frontend/src/components/{AuthGate,EngineGate}.tsx`,
  `packages/project-shell/src/ProjectGate.tsx`, `apps/pl8/frontend/src/Gate.tsx` and
  `apps/z0/editor/src/Gate.tsx`. Left as is: short presentation blocks, no risk of silent drift — but
  one grows per gate, which makes this count a thing to re-check.
- **The four app `turbo.json`s** (`apps/{k7,st0,pl8,z0}`) are **identical byte for byte**, and their
  `tasks.dev` block reproduces the root one they inherit through `"extends": ["//"]`. They override
  nothing.

### Left on purpose

`where()` (`apps/pl8/frontend/src/engine/EnginePicker.tsx`, `apps/z0/editor/src/Gate.tsx`) is two
identical lines whose only natural home would be `packages/web-protocol/quality.ts`, beside
`formatLatency` — but that package contains **no** French UI string, and "hors de portée" would bring
the UI's language into a protocol package. Two lines are not worth that property. Same reasoning for
`signedInAs` / `currentUser()`.

`AuthUser` is declared five times, and only st0's carries `email?: string | null` and
`groups?: string[]`.

## 5. Config

| finding | where |
|---|---|
| With no test file at all: `graph-model` and `ui-eyes`. | — |
| Read in code and absent from **every** `.md`, in addition to the fourteen below: `STUDIO_BACKEND_URL`, `STUDIO_ENGINE_PORT`, `STUDIO_FILE_PORT`. | `apps/st0/frontend/vite.config.ts`, `packages/file-service/src/server.ts` |
| Imported without being declared, outside the audio axis: `ui-chains-react` + `k7-frontend` (`@storybook/react-vite`), `pl8-frontend` (`@studio/ui-editor`). | — |
| `yaml` in `st0-frontend` is not only test: `rackBuilder.ts` and `sliceSymbols.ts` import it in production. | `apps/st0/frontend` |
| `packages/web-protocol` has no `dependencies` block, and that is RIGHT — `types.ts` imports only a `type` from its own `projects.ts`. That absence of a runtime dependency is what lets `engine-client` take it to read `ENGINE_OUTBOX_MAX` without weighing down the supervisor's bundle. | `packages/web-protocol` |
| Read in code, absent from `env.example.yaml`: `STUDIO_REGISTRY_URL` (9 reads), `STUDIO_WEB_ORIGIN` (5), `STUDIO_DEMOS` (4), `STUDIO_MODELS` (3), `STUDIO_WEB_PORT` (3), `STRUDEL_SAMPLES`, `DIRT_SAMPLES`, `STUDIO_ENGINE_TOKEN`, `STUDIO_SCRATCH`, `K7_URL`, `K7_TOKEN`, `Z0_RENDER_ENGINE`, `MPV_BIN`, `CHROME`. | `env.example.yaml` |

## 6. The per-deck effects chain — cut whole

Mix is a desk: two records and a crossfader. A deck's effects chain has no place on it, and the
desk's only host (st0's `turntables` surface) draws no per-deck graph. The component had no host and
could not have one, so it and everything held alive only by it are gone. Keeping an option nothing
can mount cost 70 lines and a published subpath that lied about the package's surface. See
[packages/ui-turntables/docs/mix.md](../packages/ui-turntables/docs/mix.md).

What still needs cleaning: `M9_ICONS` carried the name of an application that does not exist, and
that name still lingers in `env.example.yaml`, `docs/tokens.md` (one row of the prefix table),
`engine/moteur/AGENTS.md`, `apps/pl8/backend/src/server.ts`, `packages/web-protocol/types.ts`,
`apps/z0/AGENTS.md` and the `SessionRegistry_test.cpp` fixtures.

> **The trap that cleanup is worth writing down.** A test file named after a module regularly covers
> another one through a shared helper: under a `describe` titled "the graph and the document agree"
> sat four tests that checked `deckDoc` — that is, `deck.ts`, very much alive — the module order
> (audible), the wire form of `plugin:`, the bypass, and the module with no `plugin:` block. Deleting
> the file "because it tests dead code" would have lost them silently. They live in `deck.test.ts`,
> under "a deck's modules, in the document".
>
> The rule: **a test file does not die with its subject, its tests die one by one.**

## 7. Generated, no effect

`apps/studio-desktop/staging/{file-service,engine-host}.mjs` and the `.turbo/cache/*-manifest.json`
entries are build artefacts: they disappear at the next `stage.mjs`. The source of truth is
`packages/engine-protocol/sessions.ts`.
