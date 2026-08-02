# AGENTS.md — lanes root

A **text-based DAW**. Your song is a folder of YAML files; the terminal or a web editor
is your studio.

## The four services

| Service | Language | What it does |
|---|---|---|
| `engine/` | C++ | Headless audio server. Receives compiled `ProjectDoc` JSON, diffs it against the current state, applies changes to a Tracktion Engine edit, plays audio, pushes transport/meter state back over WebSocket. Never parses song files. |
| `engine-tray/` | Rust (Tauri v2) | The menu-bar **view** for the supervisor. Spawns `packages/engine-host/` as a child and drives it over NDJSON on stdio, drawing the snapshots it reports and sending clicks back. Also creates the Windows job object that makes the whole tree die with it. Computes no policy of its own. |
| `web/` | TypeScript (React + Express) | The web editor. Three sub-packages: `web/frontend` (React + Vite + Tailwind v4), `web/backend` (Express — OIDC auth + engine registry only), `web/shared` (wire types). The browser talks to three servers: the backend (same-origin), the file service (cross-origin, direct), and the engine (WebSocket, direct). |
| `packages/file-service/` | TypeScript | Runs on the engine's machine. Owns `~/.lanes/root/<user>/<workspace>`, serves every file operation to the browser directly (cross-origin, CORS-gated). Dials the local engine to compile-and-send projects. |

## Shared packages (`packages/`)

These are npm workspace members consumed as **raw TypeScript source** (no build step,
run via `tsx`). They are the "brain" of the system — the song compiler, the engine
client, the command layer:

| Package | Role |
|---|---|
| `song/` | The song compiler. Parses a YAML folder in-process (Zod-validated), compiles to `ProjectDoc`/`GraphDoc`, resolves Strudel patterns, handles file edits. |
| `commands/` | Shared command layer. Every editing capability is a stable SID (`module.create`, `transport.play`, …) with one handler. Same feature fires from the web command bar and `lanes cmd`. |
| `engine-client/` | Node-side link to the C++ engine. Drives it over WebSocket, manages the engine daemon (`~/.lanes/engine.pid`), finds the built binary. |
| `engine-host/` | **The** engine supervisor. Owns the `~/.lanes` contract — identity, settings, the advertised addresses, the registry heartbeat, the web-UI allowlist — and the engine and file-service processes. Spawned by `engine-tray/` and driven over stdio; not a standalone CLI. |
| `engine-protocol/` | Types only — the single source of truth for the JSON wire shapes shared between the Node client, the browser client, and the C++ engine. |
| `file-service/` | See the services table above. |
| `translator/` | `.dawproject` → YAML song folder. Parses the ZIP, maps the track model to lanes's node model, writes the output files. |
| `ui-chains/` | Routing-graph layout engine. Compiles a project graph to dagre geometry. The web app draws the result as DOM nodes + SVG cables. |
| `ui-editor/` | CodeMirror extensions: the YAML language support, schema-aware completions, entity links, and the sequence tracker note-grid widget. |
| `ui-eyes/` | WebGL video compositor. Takes a song's video tracks and composites them onto a viewport, in real-time or frame-by-frame to a file. |

## How the services talk to each other

```
                           ┌──────────────────────────────────┐
                           │         YAML song folder          │
                           └───────────────┬──────────────────┘
                                           │ file reads (in-process, Zod-validated)
                                           ▼
┌────────────────┐  WebSocket   ┌────────────────┐
│ @studio/     │◄────────────►│    engine/      │
│ engine-client  │  (JSON)      │    (C++)        │
│ (Node/TS)      │              │  Tracktion +    │
└────────────────┘              │  IXWebSocket    │
     │                                        ▲
     │ register/deregister                    │ audio out
     ▼                                        │
┌────────────────┐  HTTP/registry  ┌──────────┴───────┐
│ web/backend    │◄───────────────►│  engine-host/    │
│ (Express)      │  heartbeat     │  (Node/TS)       │
│ auth + registry│  deregister    │  THE supervisor: │
└───────┬────────┘                 │  spawns engine + │
        │                          │  file service    │
        │                          └────────▲─────────┘
        │                                   │ NDJSON on stdio
        │                          ┌────────┴─────────┐
        │                          │  engine-tray/    │
        │                          │  (Rust/Tauri)    │
        ▼                          │  the menu-bar    │
                                   │  VIEW; owns the  │
                                   │  job object      │
                                   └──────────────────┘
┌────────────────┐  CORS (direct)  ┌──────────────────┐
│ web/frontend   │◄───────────────►│  file-service/   │
│ (React/Vite)   │                 │  (Node/Express)  │
│                │  WebSocket      │  file ops, song  │
│                │◄───────────────►│  compile, engine  │
│                │  (direct)       │  link             │
└────────────────┘                 └──────────────────┘
        ▲
        │ same-origin /api + /auth
        ▼
   web/backend (auth + engine registry)
```

### The data flow when a file is edited

1. The user edits a `.yaml` file (via the web editor or CLI).
2. `@studio/song` re-compiles the project: the YAML files are read in-process and
   validated (Zod) into a flat `ProjectDoc` JSON.
3. The compiled `ProjectDoc` is sent to the C++ engine (via `engine-client` or the
   browser's WebSocket).
4. The engine `diff()`s the new doc against the current one, `apply()`s the minimal
   change to the Tracktion Engine edit, and plays audio.
5. The engine pushes `state` (playhead, meters) and `applied` (what changed) back.

### The engine identity and registry contract

A unique engine instance is identified by `~/.lanes/engine-id.json` (a persistent id
+ secret token). The engine echoes both on `whoami`, so a lookalike listener can't
produce the real token.

**`packages/engine-host/` is the only implementation of this contract.** It mints and
reads the identity, spawns the C++ engine and the file service, heartbeats to the web
server's registry (default `https://studio.frediver.se`), and deregisters on shutdown
rather than waiting out the TTL. `engine-tray/` is its view: it renders what the
supervisor reports and forwards clicks, and holds no second copy of any of it.

There used to be two parallel implementations here, and keeping them in step was a
standing rule. They diverged anyway — different machine fingerprints, one advertising
link-local addresses the other dropped, one writing the engine log where nothing read it.
The single implementation is what replaced the rule.

### Auth: two different mechanisms

| Surface | Auth mechanism |
|---|---|
| **Browser → web/backend** | OIDC session cookie (`lanes.sid`). Same mechanism as other frediverse apps. Falls back to a "Dev User" stub when no `OIDC_*` env is set. |
| **Browser → file-service** | Custom headers: `x-lanes-{user,workspace,engine-token}`. No cookie. CORS is the actual security boundary (deny-by-default, loopback/private only + user-trusted origins from `~/.lanes/web-origins.json`). |
| **Engine-host/tray → web/backend** | Token-based (`/api/registry/heartbeat`, `/api/registry/deregister`). Not browser auth. |

### Dev vs packaged builds

- **Dev (`npm run dev`)**: the tray does NOT spawn the file service — `npm run dev` runs
  it with hot-reload (`tsx watch`) on port 8770. The tray finds the engine in the repo's
  `engine/build/` dir. Editing engine or file-service code needs no tray rebuild.
- **Packaged app**: `scripts/build-engine.mjs` builds the C++ engine, bundles the file
  service and the engine host into single `.mjs` files (via esbuild), vendors Node, and
  stages everything as Tauri sidecars/resources. The .app is self-contained.

## Key conventions

- **The engine never parses song files.** It only receives compiled JSON. Swap any
  frontend for another and the engine is unchanged.
- **Commands are the single source of truth.** `@studio/commands` owns the SID →
  handler mapping. The CLI and web both dispatch through it. Add a feature there, both
  surfaces get it.
- **Many browser tabs may drive concurrently.** There is no single-tab lease on the file
  service. Last write wins; tabs reconcile via polling.
- **Wire shapes live in `@studio/engine-protocol`.** Both the Node client and the
  browser client import them. A wire change must also update the C++ engine's
  serialization (verified by running the engine, not by TypeScript).
- **All JS packages are consumed as source.** No build step. Run via `tsx`. Import via
  `package.json` `exports` subpaths — bare deep imports fail.

## How comments are written

Two rules, and they hold in every language here — TypeScript, Rust, C++:

1. **A file's header comment summarises what the file does in 5 lines or fewer.** When
   that isn't possible, the full explanation goes in a markdown page beside the code and
   the header ends by naming it: `See docs/<topic>.md.`
2. **Inline comments are one-liners.** One sentence. Wrap it to the file's column width
   when it needs a second line, but never write a paragraph between statements.

The prose itself matters — this codebase writes down the *why*, not just the *what*, and
these rules are about where that prose lives, not about having less of it. Long rationale
belongs in the zone's `docs/` directory:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the web frontend | `web/frontend/docs/` |
| the C++ engine | `engine/docs/` |
| the tray app | `engine-tray/docs/` |
| the build scripts | `scripts/docs/` |

(These are notes for developers. `lanes/docs/` is different — that is the user-facing
documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that produces
an unreadable 500-character line and can swallow an `eslint-disable-next-line` or a
`biome-ignore` directive, which silently stops working unless it starts its own comment.
Condense to a single sentence and move the rest to a doc page.
