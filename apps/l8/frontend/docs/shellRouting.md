# The shell's screen state and its URL

`routes.ts` holds the table; `useViewRoute.ts` keeps the two in step.

## The three orthogonal pieces (`routes.ts`)

The shell's screen is three independent pieces of state, which is why this needs a table
rather than a component tree:

| piece | meaning |
|---|---|
| `view` | the layout — `global` (timeline over chains) or `video` (the viewport takes the lower slot). Mostly derived: opening a project with picture selects `video` on its own. |
| `full` | which single pane has the whole screen, or `null` for the layout above. |
| `panel` | the side panel (mixer, graph, docs, logs, editor), independent of both. |

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
