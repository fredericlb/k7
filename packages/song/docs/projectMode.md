# `project_type` — a song, or a rig

An l8 project has two shapes, and `project.yaml` says which:

```yaml
project_type: live     # or `arrangement`, which is the default
```

`arrangement` is a **song**: clips placed in bars, a transport that rolls through them. `live` is a
**rig**: nothing is placed in time, so there is no arrangement at all and l8 draws the chains graph
on the whole screen.

> **This is no longer the whole story about the timeline.** The timeline is a SURFACE now
> ([surfaces.md](surfaces.md)): an `arrangement` project draws one because it carries a
> `surfaces/timeline.yaml`, not because of the line above. What `live` still does is close the
> layout down to one pane — and it also silences the warning a song without a timeline surface
> otherwise gets, which is the one thing here that reads the mode at all.

## Why it is not `type`

`project.yaml` already has a root `type:` — `l8`, `m9`, `z0` — and the two are different
questions asked at different levels:

| | question | answered by |
|---|---|---|
| `type` | which APP opens this folder | the folder's **suffix**, with the file as a fallback (`projectType.ts`) |
| `project_type` | which of l8's two shapes it has | the **file**, and only the file |

They are siblings at the root rather than one nested in the other because they are the same *kind*
of fact: what the folder IS, and therefore which entities it is allowed to hold. The `project:`
tier below them is the song's own settings — its tempo, its rate — and a shape is no more one of
those than a dialect is. That distinction is the one `libraries_from` got wrong in the other
direction, which is why `projectSchema.ts` states it twice.

The suffix decides `type` and cannot decide this one: **both shapes live in a `.l8` folder and
both are opened by l8**. There is nothing in the name to read, so the declaration is authoritative
here in a way it deliberately is not for the dialect.

### The names

The YAML key is `project_type` because that is what it is called from the outside — the project's
type, within l8. The TypeScript type is `ProjectMode`, because `ProjectType` in that same file
already means the dialect and two types of that name would be read as one. The mismatch is
deliberate and is the only place it exists; `PROJECT_MODES` is pinned against the wire type with
`satisfies`, exactly as `PROJECT_TYPES` is pinned against `ProjectApp`.

## How it reaches the screen

The browser reads no YAML — it reads the **compiled** document. So the mode takes the road
`strudel` already takes, and for the same reason: it is a fact the compiler knows and every
surface would otherwise re-read `project.yaml` to learn.

```
project.yaml            root `project_type`
  → ProjectFileSchema   packages/song/src/yaml/projectSchema.ts   (.strict(), so it must be declared)
  → RawProjectRoot      packages/song/src/rawDoc.ts
  → ProjectDoc.mode     packages/engine-protocol/project.ts
  → WebProject.mode     packages/web-protocol/types.ts            (workspace.ts copies it)
  → useProjectDoc       apps/l8/frontend/src/hooks/useProjectDoc.ts
  → viewPanes(view, …)  apps/l8/frontend/src/routes.ts
```

**The C++ engine is not involved.** `docFromJson` decodes by key with defaults and ignores what it
does not know, and the engine plays the tracks it is handed whichever shape they came from. The
field rides `ProjectDoc` because that is where the compiled header lives, not because the engine
wants it — the same arrangement `strudel` has, and the same one picture explicitly did *not* get
(see the note above `ProjectDoc`).

`projectModeOf(dir)` is the Node-side reader, for code that has a folder rather than a doc. It
lives in its own file so that "which dialect" and "which shape" cannot be confused at the import.

## What `live` does to the shell

A view in l8 is a **layout, not a mode** — every pane is mounted exactly once and `hidden` takes it
off screen, so nothing loses its caret, its undo history or its camera. `live` keeps that
invariant: it is a second `View`, and `viewPanes` says what each layout does with the panes.

```ts
viewPanes("global", true)  // { ring: ["timeline", "chains"], fullscreen: ["editor", "timeline", "chains"] }
viewPanes("global", false) // { ring: ["chains"],             fullscreen: ["editor", "chains"] }
viewPanes("live",   _)     // { ring: ["chains"],             fullscreen: [] }
```

The second argument is whether the project declares a timeline surface — which is why this is a
function and not the table it used to be. `global` without one keeps its EDITOR, and that is the
difference from `live`: a song that has not declared an arrangement is still a song whose files you
are there to edit; a rig's one pane already has the window.

`live` fullscreens **nothing**, and that is not an omission: its one pane already has the window,
so every `full` value would either do nothing or hide the only thing on screen. That single empty
list is what closes the header buttons, the number keys, `ui <pane>` and the mobile tabs at once,
because all four go through `fullscreen()`.

What goes away with the timeline: the transport (every control on it addresses a position in an
arrangement), the minimap (a second view of that arrangement), the pane buttons, the mobile tabs.
What stays: the graph, the command bar, the panels, and the settings and share menus.

### The editor is still reachable

It is not a pane here, and it does not need to be. `ui file` — which is what right-clicking a
module node runs — brings the editor up as a **popin**, over the layout, and a popin belongs to no
layout. That is the path the bench needs: right-click a node, its `module.yaml` opens, and
the **Builder** button on that toolbar opens the module builder. Removing the editor pane does not
remove any of it.

### It is derived, never chosen

There is no toggle anywhere. The layout follows the open project (an effect on `mode` in
`App.tsx`), and `ui global` typed at a live project is refused out loud rather than silently doing
nothing. `baseViewRef` is what the handful of "back to the view" call sites read, so none of them
writes `"global"` literally any more — that was correct only while `global` was the sole layout.

**One frame of flash.** `mode` is `arrangement` until the first `/project-doc` lands, so a live
project shows an empty timeline for the frame between mount and that fetch. It is paid there
rather than by holding the whole shell back on a fetch. The pre-render fix, if it is ever worth
it: `POST /open` already returns `WorkspaceInfo` and `ProjectGate` throws the response away —
widening that and the gate's `children` callback would carry the shape before `<App/>` mounts.

## The bench is the first one

`apps/st0/docs/banc.md` had already described a live project without the word: *« pas un morceau »*
— nothing arranged, nothing recorded, `recordDir` unset, the track with no clip. The bench is a
track, a chain and an output, and the exercise is entirely the graph. `scaffoldBench.ts` writes
`project_type: live`, and because a bench's `project.yaml` is written once while its `modules/`
and its chain are regenerated, `ensureBenchProject` also brings an already-existing bench
forward — comment preservingly, and only when it is not already live.

(There were two benches; the one over the whole module catalogue is gone, and a shared module is
edited from l8's Libraries tab. The bench that remains is a médiathèque CHAIN, and it is live for
exactly the same reason.)

## Creating one

st0's « Nouveau projet » shows a second row of buttons for l8, `arrangement | live`. It is a
separate field all the way down — it cannot ride on `type` (`"audio" | "m9"`) and it cannot
ride on the folder suffix, since both shapes are `.l8`. Absent means `arrangement`, so every caller
written before it — l8's own command bar included — keeps creating exactly what it always did.

The live scaffold is the song scaffold with the arrangement taken out: no sequence, no clip, no
pattern, no placement. What is left is a signal path you can play through — a track, an
instrument, the output — and `contentType: sequences`, so a MIDI controller plays it as soon as
the engine is up.
