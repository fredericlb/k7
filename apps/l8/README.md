# l8

A **text-based DAW**. Your song is a folder of YAML files; the terminal (or a web
editor) is your studio.

l8 is a set of processes talking over a WebSocket, living inside the `studio`
monorepo:

```
 song (YAML folder) ─► packages/ (Node)                 moteur   (C++)
                      ├─ parse + validate (Zod)         ┌──────────────────────────┐
                      ├─ resolve clip paths ──project─► │ diff() vs current        │
                      ├─ compile to ProjectDoc (JSON)   │ apply() → Tracktion Edit │
                      ├─ file-watch → live reload       │ audio out of speakers    │
                      └─ transport ──play/stop/etc────► │                          │
                               ▲                        │                          │
                               └───── state (playhead, ─┤ WebSocket server         │
                                      meters, applied)  └──────────────────────────┘
```

- **The JS packages** (Node) are the only song interpreter: they compile a project
  folder to a flat `ProjectDoc`/`GraphDoc`, send it as JSON, watch files for live
  reload, and send transport commands. They have no UI of their own — the web
  backend and the CLI consume them as source.
- **`engine/moteur`** (C++) is a headless audio server. It never parses project
  files — it receives a compiled project as JSON, keeps the smart
  `diff()`/`apply()` logic, plays audio, and pushes transport/meter state back.

The engine has no idea a terminal exists. Swap the web app for a REST service and
the engine is unchanged — it only speaks the JSON protocol below.

## Where the pieces live

None of this is under `apps/l8` any more. The engine, the tray and the brain
packages serve every audio app in the repo — st0 and m9 are coming —
so they sit beside l8 rather than inside it. What remains here is the web
editor: `frontend` and `backend`.

The JS packages are **members of the monorepo's npm workspaces**, consumed as raw
TypeScript source and run via `tsx` — no build step. The engine is a native C++
binary, built separately.

```
engine/moteur/               the C++ project (studio-moteur)          — native, not a workspace
  CMakeLists.txt · CMakePresets.json · docs/design.md
  engine/    library studio::engine  (ProjectDoc, ProjectDiff, EngineHost/Tracktion)
  server/    app studio-moteur       (WebSocket audio server, main.cpp)
engine/capot/                the menu-bar view (spawns @studio/engine-host, the supervisor)
apps/l8/                the web editor — frontend / backend
packages/                  studio's shared tier (consumed as raw TS source):
  song/                    @studio/song            — song model + compiler + Strudel patterns
  commands/                @studio/commands        — shared command layer, file edits, timeline, mixing
  engine-client/           @studio/engine-client   — drives the engine over the WebSocket protocol
  engine-host/             @studio/engine-host     — THE supervisor: identity, registry, engine + file-service processes
  engine-protocol/         @studio/engine-protocol — the JSON wire shapes shared with the C++ engine
  file-service/            @studio/file-service    — serves file ops + compiles projects for the browser
  ui-chains/               @studio/ui-chains       — routing-graph engine: dagre layout (drawn by the web app as DOM nodes + SVG cables)
  ui-editor/               @studio/ui-editor       — CodeMirror YAML language + tracker note-grid (web UI)
  translator/              @studio/translator      — DAWproject (.dawproject) → song folder; `l8 import` is its caller
  web-protocol/            @studio/web-protocol    — the browser↔server wire types
```

The C++ engine is described in
[../moteur/docs/design.md](../moteur/docs/design.md) (diff-apply strategy and
threading rules). Development conventions for future Claude Code sessions are in
[CLAUDE.md](CLAUDE.md).

## The song format — a YAML folder

A song is a **folder of YAML files**, read in-process and validated with Zod —
no external tooling to install. Any YAML-aware editor works; the web editor adds
schema-driven autocompletion derived from the same Zod schemas.

```
project.yaml           header + trackOrder + markers
settings.yaml          project settings (metronome, count-in)
chains.yaml            the routing graph
tracks/<id>.yaml       track config + clip refs
clips/<id>.yaml        audio clips
sequences/<id>.yaml    MIDI clip config + inline notes ({t,d,k,v} mappings)
curves/<id>.yaml       automation curves (lfo / custom points)
algo/<name>.strudel    live Strudel patterns (played only when a strudel track links one)
modules/<type>/<name>/module.yaml  modules: a plugin/io/rack + `params?`, optional `extends: "…"`
                                   (type ∈ io|instruments|audio|transformers|video_effects — the folder gives the kind)
modules/<type>/<name>/<inst>.yaml  an INSTANCE of that module (inherits module.yaml), used
                                   in a chain as "<name>:<inst>"
<name>/<name>.vstpreset · <name>/<audio>.wav   the module's own preset + rack audio
```

- **A track is a `single`, a `group` or a `strudel` lane.** A single holds material,
  and its `contentType` fixes which kind: an `audio` track takes clip refs only, a
  `sequences` track takes sequence refs only — one track never mixes the two. Omit
  `contentType` and it's inferred from the refs.
- **A group holds no material — only membership.** `tracks` lists the member track
  ids. That's all a group is.
- **There is no picture here.** l8 drew video tracks until they left for `apps/v1`,
  which cuts in seconds against a wall clock rather than in beats against a tempo. A
  `video_tracks/` folder in a song is now a compile error naming where it belongs. The one
  thing that genuinely went with it is `video_source` — an audio track inheriting a video
  lane's placements — which cannot exist once the two are two folders. See
  [packages/song/docs/v1Project.md](../../packages/song/docs/v1Project.md).
- **A `strudel` track streams its material from a pattern.** `strudel` links one file
  under `algo/`, and the track's **name** (defaulting to its id) picks which lane of
  it to receive — the pattern's `.label("…")`, matched ignoring case and punctuation.
  Nothing static can check that match, since labels only exist once the pattern runs,
  so it's checked when playback starts. **A `.strudel` file no track links to is
  ignored**: `algo/` is a library you pick from, not a folder that autoloads.
- **A strudel lane is a track like any other**: a stable id, so `chains.yaml` can route
  it from `from:` and the mixer can set its gain/pan/mute/solo. Its `contentType`
  decides how the pattern's events are read, so a chain and a pattern can't disagree:
  `sequences` makes every event a MIDI note played by whatever instrument the chain
  provides (`s(…)` picks a waveform, not a plugin); `audio` makes every event a sample
  one-shot (`s("bd")` names the sample).
- **A lane no track declares still plays.** The clock mints a live track for it, named
  after its label — or, for unlabelled events, one per orbit named `strudel <orbit> …`.
  Declaring a lane is the opt-in that buys the id, the chain and the mixer strip;
  jamming in a fresh pattern needs no ceremony.
- **A module carries a plugin (or io, or a rack) plus params**, and may **`extends`**
  another module to inherit its defaults — the same defaults-plus-overrides merge the old
  blueprint→module split gave, now between any two modules. Its **kind** and input port
  come from its type folder. Several modules can extend one *base module*.
- **A module is its own folder** `modules/<type>/<name>/` — the **folder** names the
  module (how chains reference it via `use`), and the file inside is always `module.yaml`:
  a flat mapping of the module's own attributes (a `plugin`/`io`/`rack`, optional
  `params`/`extends`), with **no `name:`**. The folder also holds the module's own
  `<name>.vstpreset` (overriding an extended module's) and its rack's audio. The io sink
  is a module too (`modules/io/OUT/module.yaml`, `io: "out"`). `l8 cmd new module`
  writes the right shape;
  `engine/capot/songs/synth-demo.l8/modules/instruments/synth/module.yaml` is the
  reference, and `.../kit` shows `extends`.
- **A project's USES of a module are instances**, in a flat `instances/` folder at the
  project root. The **filename names the instance** — a chain says **`{module: "lead"}`**,
  not the module it came from — and the file says which module it uses with `extends:`.
  Same flat shape as `module.yaml`; state only what this use changes. Each keeps its own
  params and its own `instances/<name>.vstpreset`, so tweaking one never touches the module
  or another use; the merge order is *extended base → the module → the instance*. The folder
  is flat on purpose: an instance does not mirror the folders of what it uses, so using a
  médiathèque module needs no local folder for it. `l8 cmd new module-instance
  instruments/synth lead` scaffolds one, and `engine/capot/songs/synth-demo.l8/instances/`
  is the worked example — one 4OSC module, a `lead` and a `pad`, each driving its own chain.
  See `packages/song/docs/instances.md`.
- A **chain** (in `chains.yaml`) is a signal path, written as a flat list of nodes: a
  **head**, the modules the signal passes through, and the sink it ends at. `chains` is
  a **list**, not a map — a chain needn't be named.
- **The head node says where the signal comes from, and names the chain.**
  `{track: "melody"}` — unnamed, so the chain simply *is* `melody` (which is what nearly
  every chain wants: a name there would only be the track's id typed twice).
  `{track: "vox", as: "vox dry"}` — named, for when something has to route into it.
  `{chain: "reverb"}` — a **bus**: no source of its own, fed by other chains ending at
  it. A bus must use this form, which is also what makes it visible as a destination
  instead of something you infer by scanning every other chain's last node.
- **The resolved name is an identity**, not a label: it's what a step names to route
  there, what the bus track is called, and the prefix of every plugin id under the
  chain. Two chains resolving to the same name is an error.
- `OUT` is the built-in main sink; any io module works as one.

## Build

### The JS packages (libraries, CLI, web)

Node ≥ 18. From the **repo root** (they're workspace members):

```sh
npm install          # links all workspaces; no per-package build step
```

### The engine (C++)

Native low-latency audio is built on Windows with MSVC (ASIO/WASAPI) or on macOS with
AppleClang (CoreAudio), from the repo root:

```sh
npm run build:win --workspace moteur   # cmake --preset windows-msvc && cmake --build --preset windows-msvc
npm run build:mac --workspace moteur   # cmake --preset macos-clang  && cmake --build --preset macos-clang
```

The macOS build needs `brew install cmake ninja` (it uses the Ninja generator, not
Xcode — so the Command Line Tools are enough, no full Xcode.app). It targets macOS
11.0+ and builds native arm64. Sanity-check the result without starting a server:

```sh
./engine/build/macos-clang/studio-moteur --list-audio-devices   # lists CoreAudio devices, then exits
```

On Linux, build with a preset from `engine/moteur/CMakePresets.json` (`dev-gcc`,
`dev-clang`, `asan`, `release-gcc`); the first configure fetches JUCE + Tracktion
(hundreds of MB). Requires CMake ≥ 3.24, a C++20 toolchain, and the JUCE Linux
dev deps (needed even headless):

```sh
sudo apt update && sudo apt install -y \
    build-essential cmake ninja-build git zlib1g-dev \
    libasound2-dev libjack-jackd2-dev ladspa-sdk libcurl4-openssl-dev \
    libfreetype6-dev libfontconfig1-dev \
    libx11-dev libxext-dev libxrandr-dev libxrender-dev \
    libxcomposite-dev libxcursor-dev libxinerama-dev \
    libglu1-mesa-dev mesa-common-dev libwebkit2gtk-4.1-dev

cd engine
cmake --preset dev-gcc
cmake --build --preset dev-gcc -j
# binary: engine/build/dev-gcc/studio-moteur
```

## Run

The **web editor is the only editing surface** — it connects to the engine via
WebSocket. (There used to be an Ink terminal UI; it's gone. The command bar,
the shared command layer, and `l8 cmd` all outlived it.) For a look at a
project without opening anything, `l8 inspect graph` prints the routing and
`l8 inspect timeline` prints the tracks and their clips.

The web editor remembers the **active project** in a session file
(`~/.studio/session.json`) so it comes back where you left it. The file service
reconnects automatically if the engine restarts and reloads the song whenever a
file changes on disk. `applied` messages (the exact diff the engine ran) show in
the UI log, so editing a file and saving shows you precisely what the engine did
in response.

## The protocol

JSON over `ws://127.0.0.1:8765` (default). A sample of the message types:

```jsonc
// client → engine
{ "type": "project",        "doc": { /* compiled ProjectDoc */ } }
{ "type": "transport",      "action": "play" | "stop" | "toggle" | "rewind" }
{ "type": "list-plugins",   "filter": "…" }
{ "type": "rescan-plugins", "force": true }
{ "type": "show-native-plugin-ui", "id": "…" }

// engine → client
{ "type": "applied", "changes": ["tempo -> 124 bpm", "+ clip on bass"] }
{ "type": "state",   "playing": true, "playhead": 4.2, "levels": [-100, -100] }
{ "type": "error",   "message": "…" }
```

## Troubleshooting (C++ engine, Linux)

Run from `engine/moteur/`, in the order you'll hit them.

**`git@github.com: Permission denied (publickey)` during the JUCE submodule
clone** — Tracktion's `.gitmodules` hardcodes the JUCE submodule as an SSH URL.
Redirect GitHub to anonymous HTTPS (keeping SSH for your own pushes):

```sh
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."git@github.com:".pushInsteadOf "https://github.com/"
rm -rf engine/build
```

**`fatal error: 'X11/extensions/Xrandr.h' file not found`** — JUCE builds its
`juceaide` helper first, which needs the full X11 + font dev stack even headless.
Install the dependency list above.

**`unrecognized command-line option '-Wshadow-all'`** — mixed toolchain. Use a
preset (it pins both C and C++ compilers) from a clean build dir:
`rm -rf build && cmake --preset dev-gcc`.

**`Segmentation fault` linking `EngineInPluginDemo`** — Tracktion example plugins
whose LV2 helper crashes headless/WSL. The presets pin
`"targets": ["studio-moteur"]` so a normal preset build skips them; only a plain
`ninja` / `cmake --build build` (all targets) hits it.

**No sound in WSL2** — point ALSA at WSLg's PulseAudio:

```sh
sudo apt install -y libasound2-plugins pulseaudio-utils
printf 'pcm.!default pulse\nctl.!default pulse\n' | sudo tee /etc/asound.conf
```

High latency and no ASIO/WASAPI under WSL — build the `windows-msvc` preset
natively for real low-latency audio.

## License

GPLv3 — see [engine/LICENSE](engine/LICENSE). Tracktion Engine is GPLv3 or
commercial.
