# General rules on development

- Prioritize using existing libraries whenever possible. When you found one, show its strengths and weaknesses and ask if you should include it. 
- Comments at the top of a file should summarize what the file is doing in less than 5 lines. If it is not possible to explain this clearly in <=5 lines, add a md file explaining it fully in docs/[topic].md
- Inline comments should be one-liners

Those two rules hold in every language here — TypeScript, Rust, C++ — and they are
about *where* the prose lives, not about having less of it. This codebase writes down
the **why**. Long rationale belongs in the zone's `docs/` directory:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the lanes frontend | `apps/lanes/frontend/docs/` |
| the C++ engine | `apps/moteur/docs/` |
| the tray app | `apps/capot/docs/` |
| the build scripts | `apps/capot/scripts/docs/` |

(Those are notes for developers. `apps/lanes/docs/` is the exception: it is the
user-facing documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that
produces an unreadable 500-character line and can swallow a `biome-ignore` directive,
which silently stops working unless it starts its own comment. Condense to a single
sentence and move the rest to a doc page.

# This repo

`studio` holds the music/stage apps. The audio side is **four processes in four
directories**, which is why this overview lives at the root and not inside any
one app:

| dir | language | what it is |
|---|---|---|
| `apps/moteur` | C++ | The audio engine. Receives a compiled `ProjectDoc` over WebSocket, diffs it, plays audio, pushes transport and meter state back. **Never parses song files.** |
| `apps/capot` | Rust (Tauri v2) | The menu-bar **view** over the supervisor. Spawns `@studio/engine-host` and drives it over NDJSON on stdio. Computes no policy of its own. |
| `apps/lanes` | TypeScript | The text-first DAW: `frontend` (React/Vite) + `backend` (Express — OIDC auth and the engine registry only). Owns the timeline; shares the chains view. |
| `apps/mediatek` | TypeScript | The media library — morceaux, samples, modules. A SPA with no backend of its own: it borrows lanes' for auth and the registry, and reads the catalogue from the local file service. |
| `apps/obscura` | TypeScript | The blind-test game — six SPAs behind one origin. |
| `apps/radiok7` | TypeScript | The rehearsal recorder — sessions, takes, tablature, tuner. |

`packages/` is **studio's own shared tier** — the song compiler, the command
layer, the engine client and supervisor, the three framework-agnostic view
engines, and the waveform component. All are `@studio/*` and are consumed as
**raw TypeScript source**: no build step, imported through `package.json`
`exports` subpaths, so a bare deep import fails on purpose.

They are named `@studio/*` rather than `@lanes/*` because lanes is only one of
their consumers: `apps/mediatek` and `apps/platines` are coming, and obscura will
follow.

`commons/` is a **git submodule** — the shared base, also used by the `phare`
monorepo. Editing something under `commons/` means committing in two places:

```bash
cd commons && git commit -am "…" && cd ..
git add commons && git commit -m "bump commons"
```

`push.recurseSubmodules=on-demand` is configured, so pushing the parent pushes
commons first. Never edit `commons/` for something only studio needs — put it in
`packages/` instead: that is the line between "shared with phare" and "shared
inside studio".
