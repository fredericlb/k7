# The shell's screen state and its URL

`routes.ts` holds the table; `useViewRoute.ts` keeps the two in step.

## The three orthogonal pieces (`routes.ts`)

The shell's screen is three independent pieces of state, which is why this needs a table
rather than a component tree:

| piece | meaning |
|---|---|
| `view` | the layout — `global` (timeline over chains) or `live` (chains alone, no timeline). Entirely derived: it is what the open PROJECT is, and nothing offers a choice. |
| `full` | which single pane has the whole screen, or `null` for the layout above. |
| `panel` | the side panel (graph, docs, logs), independent of both. |
| `surface` | a `view` surface the PROJECT declares (`surfaces/`), over the layout — `/surface/<id>`. |

`surface` is its own field and not a `Pane`, for the reason the table cannot show: the panes are
a closed union the shell declares, while a surface's list is the project's and is not knowable
until one is open. It stacks like `help` — over the layout, which is untouched underneath — and
`toPath` names the topmost of the three (help, then surface, then a fullscreened pane). See
[packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

A **`split`** surface is not in this table at all, and that is the point of the word: it is *in*
the layout rather than over it, so it has no address of its own and never appears in `surface`.
There are two — the timeline and the viewport. What they do reach is the pane list below, which
is why that stopped being a constant.

### The layout is the project's, not the user's

`view` has always been mostly derived — a `video` layout used to be selected by "this project has
picture". That fact is a PANE now rather than a layout: the project declares a `viewport`
surface, and the layout list did not have to grow a row for it. `live` is the same shape of fact
taken to the end: `project.yaml`'s `project_type` says whether the folder is a song or a rig, and
a rig has no timeline to show. So there is no toggle, `ui global` typed at a live project is
refused out loud, and `viewPanes` (in `routes.ts`) is what each layout does with the panes:

```ts
viewPanes("global", true,  false) // { ring: ["timeline", "chains"],             fullscreen: ["editor", …ring] }
viewPanes("global", true,  true)  // { ring: ["viewport", "timeline", "chains"], fullscreen: ["editor", …ring] }
viewPanes("global", false, false) // { ring: ["chains"],                         fullscreen: ["editor", "chains"] }
viewPanes("live",   _,     false) // { ring: ["chains"],                         fullscreen: [] }
viewPanes("live",   _,     true)  // { ring: ["viewport", "chains"],             fullscreen: […ring] }
```

A **function**, not the table it was, because two of the panes are surfaces the project declares
rather than panes the shell hands out. The second and third arguments are those declarations, and
they have to reach here: a list naming a pane nothing will mount is a screen that cannot be drawn.

The ring is built TOP-DOWN, in the order the panes are stacked on screen — the number keys and
the mobile tabs read it, so a ring that disagreed with the column would make `2` land somewhere
the eye did not expect. And a rig that declares a viewport gets its fullscreens back: `live`'s
empty list is about having ONE pane, not about being a rig.

That empty `fullscreen` is load-bearing. The header buttons, the number keys, `ui <pane>` and the
mobile tabs all reach the screen through `fullscreen()`, so one empty list closes all four at
once instead of four guards that could disagree. `fromLocation` reads the same function:
`/timeline` typed at a live project — or at one that declares no timeline — names a pane that
project has not got, and falls through to its own screen rather than parsing into a state that
cannot be drawn.

Full rationale, including why the field is not `type`:
[packages/song/docs/projectMode.md](../../../../packages/song/docs/projectMode.md).

`full` and `view` are the SCREEN, so they own the path. `panel` is a modifier on whatever
screen you are on — you can have the mixer open over the timeline or over the chains — so
it is a query parameter. Nesting it (`/timeline/mixer`) would say it belongs to the
timeline, which it does not.

Help (`/docs`) is a path of its own because it is an overlay over everything, and because
it was already routed (as `#help`) before this table existed. `/help` is still accepted
on the way in, for links written before the rename.

## Keeping them in step (`useViewRoute.ts`)

The screen state lives in `App` and is written from a dozen places — menu clicks,
keyboard, the command bar, the "project has video" probe. Rather than lift all of that
into route components, this syncs both directions:

- **URL → state** on load, on back/forward, and on a hand-edited address
- **state → URL** whenever the screen changes by any other route

### The loop is the hazard

It is subtler than "don't write what's already there". Both decisions are pure functions
(and tested as a SEQUENCE, because the bug they encode is one of ordering): React runs
the layout effect and the passive effect in the same commit, and the passive one still
sees the state as it was BEFORE the layout effect's `apply` — so on a deep link it is
asked "did the app just move the screen?" while holding the old screen and the new URL.
Answer that wrong and the two effects push each other back and forth forever, which looks
like the page blinking and never settling.

### Replace, not push

Screen changes REPLACE rather than push, with one exception: help. Expanding a pane is a
view adjustment, and pushing every one of them would make Back mean "undo the last thing
I looked at" rather than "leave". Help is a place you go to and come back from, so it
earns an entry — exactly the behaviour the old `#help` hash had.
