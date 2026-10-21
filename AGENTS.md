# General rules on development

- Prioritize using existing libraries whenever possible. When you found one, show its strengths and weaknesses and ask if you should include it.
- **A source file over 500 lines is suspect.** Split it unless there is a reason not to, and say the reason.
- **Comments are in English**, everywhere, whatever the language of the surrounding docs.
- **A file header is at most 10 lines.** What the file does, and the one thing a reader would get wrong.
- **A comment inside the body is exactly one line.** No exceptions, no wrapped sentences, no JSDoc paragraphs.
- Long rationale goes to the zone's `docs/` page, and the code points at it.
- **Icons come from `@frediverse/ui/icons`**, never an emoji or a direct `lucide-react` import — `commons/packages/ui/docs/icons.md`.
- **Documentation is in English**, like the comments — including the pages in every `docs/`.
- **A page carries CHOICES, not mechanism.** What was decided and what forced it. Not a
  walkthrough of what happens when: the code is what says how a thing works, and prose that
  restates it is prose that goes stale without anyone noticing.
- **A page describes the project AS IT IS.** No history: no "it used to be", no account of what
  a change replaced, no migration narrative. Where a past failure is what justifies a decision,
  state the hazard in the present tense and drop the story.
- **Whenever you edit a js/ts file, make sure it passes biome's lint**

These rules hold in every language here — TypeScript and C++. The code keeps the **why** short;
the zone's `docs/` directory is where the justification belongs:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the k7 frontend | `apps/k7/frontend/docs/` |
| the médiathèque | `apps/k7/backend/docs/media/` (the routes) and `packages/ui-library/docs/` (the screens) |
| the DJ desk | `packages/k7-plugins/docs/turntables/` |
| the project shell | `packages/project-shell/docs/` |
| the C++ engine | `engine/k7-runtime/docs/` |
| the native supervisor | `engine/k7-supervisor/docs/` |
| the Android app | `engine/k7-runtime/docs/android.md` |
| the iOS app | `engine/k7-runtime/docs/ios.md` |
| the tray (k7 on a computer) | `apps/k7-tray/docs/` |
| k7's backend running the machine's supervisor | `apps/k7/backend/docs/localEngine.md`, and `packages/supervisor-host/docs/` for spawning it |
| the rehearsal recorder | `packages/rehearsal-server/docs/` (the routes) and `packages/ui-rehearsal/docs/` (the screens) |
| the engine's build scripts | `engine/scripts/docs/` |
| the plugin contract | `packages/k7-sdk/docs/` |
| k7's builtin plugins | `packages/k7-plugins/docs/` |
| the functional suite (Playwright, against a running instance or the Android app) | `e2e/docs/` |
| CI and deployment, which belong to no single app | `docs/` |

(Those are notes for developers. `apps/k7/docs/` is the exception: it is the
user-facing documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that
produces an unreadable 500-character line and can swallow a `biome-ignore` directive,
which silently stops working unless it starts its own comment. Condense to a single
sentence and move the rest to a doc page.

`npm run lint:comments` enforces the three limits above — header length, body one-liners, and
no accented prose where English is expected. It is **non-blocking**, like `lint:dead`: it reports
a debt that predates the rule and shrinks as files are touched. New code has no excuse.

# This repo

`studio` holds the music/stage apps. **Read `docs/architecture.md` before working in an area you
don't know, or touching packaging and deployment**: it is the full map of every app and package,
the production image, and the repo-wide pages in `docs/`. The short map:

| dir | what it is |
|---|---|
| `engine/k7-runtime` | C++ audio engine: receives a compiled `ProjectDoc` over WebSocket, plays it; never parses song files (its own `AGENTS.md`) |
| `engine/k7-supervisor` | C++ supervisor of the engine machine: starts and watches the engine, holds the tunnel, runs the jobs a server asks (its own `AGENTS.md`) |
| `engine/k7-android`, `engine/k7-ios` | the engine and supervisor on a phone, with k7's backend bundled (`engine/k7-runtime/docs/android.md`, `ios.md`) |
| `engine/scripts` | builds the engine and supervisor, packages the CLI archive and the tray's release files |
| `apps/k7` | the text-first DAW — frontend (React/Vite) + backend (Express: auth, prefs, the médiathèque, the rehearsal recorder, shares, engine registry) (its own `AGENTS.md`) |
| `apps/k7-tray` | k7 on a computer: a windowless Tauri app in the menu bar that runs k7's backend on `127.0.0.1:18789`, which runs the machine's supervisor and engine; k7 opens in the browser. Released by its own `tray.yml` (`apps/k7-tray/docs/`) |
| `packages/` | `@studio/*`, consumed as raw TypeScript through `exports` subpaths (a bare deep import fails on purpose); four are published (`docs/publishing.md`) |
| `k7-core/` | the `@k7-core` modules library, the seed every library folder is copied from |
| `commons/` | git submodule shared with the `phare` monorepo |
| `e2e/` | the Playwright functional suite (`e2e/docs/`) |
| `docs/` | repo-wide notes: CI, deployment, the dev session, plans, audits |

**`commons/` is a submodule**: an edit there is committed twice —
`cd commons && git commit -am "…" && cd ..` then `git add commons && git commit -m "bump commons"`.
Pushing the parent pushes commons first. Never edit `commons/` for something only studio needs —
put it in `packages/`.

**`k7-core/` is a published version**: a change to its content raises the `version` in its
`library.k7x` in the same commit, since an installed version is never rewritten
(`docs/library-versions-plan.md`). Keep its paths short (Windows' 260-character limit).

Before deleting code that merely *looks* unused, read `docs/inventaire.md`; before touching the
engine registry, the relay or a gate, `docs/audit-moteur.md`. The repo's own checks (`docs/lints.md`):

- `npm run lint:docs` — blocking: refuses a `.md` or source comment naming a file that is not there.
- `npm run lint:bytes` — blocking: refuses a NUL byte in a tracked source file (ripgrep skips it whole).
- `npm run lint:dead` — knip, non-blocking: dead and duplicated code; build-only entries go in `knip.json`.
- `npm run lint:panels` — a panel's `bind:` against its plugin's real parameters; needs the plugins installed, not in `npm run lint` (`packages/song/docs/panelBinds.md`).

# Developing on the Windows machine

**Windows only** — on macOS and Linux, edit and build in the same world and run `npm run dev`.

**Two checkouts, and only one of them runs anything.** Agents edit in the WSL clone `~/Src/k7`
(ext4, its own Linux `node_modules`) — git, biome, vitest, tsc and the lints are 3–50× faster
there. **Every build and every dev server belongs to Tilt, in the Windows checkout**
(`npm run dev` = `tilt up`, UI at http://localhost:10350): never build by hand, and never run Tilt,
a dev server or the engine build from WSL. Branch from `win/main`, then `git push win <branch>`;
the branch lands in the Windows checkout, where it is merged and where Tilt runs it. Read the
session with `tilt.exe get uiresources` / `tilt.exe logs <resource>` (`docs/dev.md`, `docs/remote.md`).

**Never use PowerShell for text in a tracked file**: it silently corrupts UTF-8 and drops accented
arguments. Write the script with the file tool and run `bash script.sh`; edit files with the edit
tool. PowerShell is for short ASCII commands only (`git status`, `npm run test`) — `docs/dev.md`.
