# The shell's screen state and its URL

`routes.ts` holds the table; `useViewRoute.ts` keeps the two in step.

## The two orthogonal pieces (`routes.ts`)

The shell's screen is two independent pieces of state, which is why this needs a table
rather than a component tree:

| piece | meaning |
|---|---|
| `full` | which single pane has the whole screen, or `null` for the layout. |
| `panel` | the side panel (graph, logs), independent of it. |

> **There was a third**, `surface`: the open `view` surface the project declared, over the layout
> at `/surface/<id>`. It was its own field and not a `Pane` because the panes are a closed union
> the shell declares, while a surface's list was the project's and not knowable until one was
> open. Every surface is a pane now — there is exactly one per type, so the type IS the name —
> and the field went with the last `view`. See
> [packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

A surface is not in this table at all, and that is the point: it is *in* the layout rather than
over it, so it has no address of its own beyond the pane's. There are three — the timeline, the
viewport and the turntables. What they reach is the pane list below, which is a function of what
the project declares rather than a constant.

### The layout is the project's, not the user's

There is ONE layout, and which panes it holds is a function of what the project DECLARES.
`viewPanes` (in `routes.ts`) is that function:

```ts
viewPanes({ timeline: true })                     // ring: ["timeline", "chains"]
viewPanes({ timeline: true, viewport: true })     // ring: ["viewport", "timeline", "chains"]
viewPanes({ timeline: false })                    // ring: ["chains"]
viewPanes({ timeline: false, turntables: true })  // ring: ["turntables", "chains"]   ← a SET
// fullscreen is ["editor", ...ring], or just the ring when `frozen`.
```

A **function**, because three of the panes are surfaces the project declares rather than panes the
shell hands out. Its argument is those declarations, and they have to reach here: a list
naming a pane nothing will mount is a screen that cannot be drawn.

An **object** rather than positional flags, because there are four of them and they are all
booleans — `viewPanes(true, false, true)` said nothing about which pane was which.

The ring is built TOP-DOWN, in the order the panes are stacked on screen — the number keys and
the mobile tabs read it, so a ring that disagreed with the column would make `2` land somewhere
the eye did not expect.

That list is load-bearing. The header buttons, the number keys, `ui <pane>` and the mobile tabs
all reach the screen through `fullscreen()`, so one list closes all four at once instead of four
guards that could disagree. `fromLocation` reads the same function: `/timeline` typed at a
project that declares no timeline names a pane that project has not got, and falls through to
the layout rather than parsing into a state nothing can draw.

> **There were TWO layouts.** `global` and `live`, chosen by nothing — `project.yaml`'s
> `project_type` said which, and a `live` folder had no timeline. Both the field and the `View`
> type are gone. They answered a question `surfaces/` answers better, and could contradict it:
> a folder calling itself `live` while declaring a timeline was a legal state nothing resolved.
> The one visible difference is the EDITOR — `live` fullscreened nothing at all, and a project
> with no timeline now keeps its editor, which is where you would write the arrangement it has
> not got. See [packages/song/docs/surfaces.md](../../../../packages/song/docs/surfaces.md).

`full` is the SCREEN, so it owns the path. `panel` is a modifier on whatever
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
