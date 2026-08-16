# The active project — what l8 and m9 are actually looking at

A workspace is **one git clone**. The project is one folder inside it. Those used to be
almost the same thing, because l8 owned the level above a project and let you pick one; now
st0 owns the repositories and opens an app **on** a project
(`packages/project-shell/docs/launch.md`). That change moved two questions here.

## The tree is the project's, not the clone's

`tree()` walks the **active project**, not the workspace root.

A real repository holds far more than the song you opened: other projects, a `_modules`
library shared between them, mixdowns, an `orig/` full of `.dawproject` and `.als` sessions
the songs were imported from. Rooting the tree at the clone shows all of it, which reads as
"l8 is showing me the repository" — and it invites you to open a file belonging to a project
that is not the one playing.

**Paths stay workspace-relative.** Only the root of the walk moves; `/file`, `/rename`,
`/move`, `/folder` are untouched and still take the same strings they always did. That is
what makes this a one-line change rather than a re-rooting of the whole API.

Two consequences worth knowing:

- With **no** active project the tree is the workspace, which is also what a lone-project
  workspace answers (its root *is* the project). Nothing regressed for either.
- The shared `_modules` library is no longer browsable as text from l8. It never was
  editable — `guardShared` refuses every write, and a UI edit forks a project-local copy —
  and the médiathèque is where the catalogue is authored. What a project needs of it still
  arrives through `/module-catalogue`, `/module-ui` and `/hints`, which are unaffected.
- A `.dawproject` sitting **outside** the project folder is likewise off the tree, so it can
  no longer be clicked to import. Importing lands a *new* project at the workspace root,
  which l8 cannot open by itself anyway — you go back to st0 for that either way.

## Opening a project that is not there

`isProjectDir` is a rule about a **name** — `mysong.l8`, `myset.m9` — because st0 must
answer the same question from a bare blobless mirror where no file can be opened
(`packages/web-protocol/projects.ts`). The trap is that a name rule says "yes" about a folder
that does not exist.

That is not hypothetical. st0 reads a **mirror**, the file service reads a **clone**, and the
two are fetched at different moments. Rename a project folder, push, and st0 will keep
offering the old name until its mirror is refreshed — st0's own fix for that is in
`apps/st0/backend/src/routes/projects.ts`, whose repository listing now refreshes the mirrors
it lists, not just the tree view. But a race is still a race, and the mirror can be a fetch
behind at exactly the wrong second.

Without an existence check, that produced this sequence:

1. `POST /open {path: "01_danse.l8"}` — accepted, because the *name* claims l8;
2. `activeProject` set to a path with nothing at it, and the `.studio-active` marker written,
   so a reload arrived broken too;
3. the first thing to compile it — `/project-doc` — reached `@studio/song`'s `loadProject`,
   which found no directory, fell through to "not a folder project", found no `.yaml` either,
   and reported **`unsupported song '01_danse.l8' — use a .yaml file or a folder project`**.

Every word of that is true and none of it is the problem. So `setActiveProject` now checks
existence **before** the name rule and says what actually happened, and `isProjectDir` itself
requires a directory — which also stops a stale `.studio-active` marker (a project deleted
outside the service) from being restored at construction.

## Whose project — the note is per SESSION

There is one engine and one link per session, and for a long time there was one note about what
was being served: a `currentWs` (which workspace) and an `engineProject` (which folder), both
module globals in `engineLink.ts`, both written by `POST /open` and by nothing else.

That is wrong in two directions at once, and each is silent.

**Null.** Between a file service restart and the next `/open` there is no current workspace, and
`sessionOf(null)` is the BARE service id — a session the engine holds nothing in. Everything
that defaulted through it addressed that empty session: a preview, a transport, an arm, a
document the turntables surface built. The engine's `previewSample` returns without a word on an
empty session, so the ▶ button clicked and said nothing; `l8 play` did nothing and reported
nothing. Nothing was broken anywhere — the message just went to an empty room.

**Somebody else's.** With two people on one file service the note names whoever opened last.
Their sockets are separate (one per session, see `sessionOf`) but the note was not, so the other
person's reconnect compared itself to a session that was not theirs, declined to re-send, and
left their project stranded. A take they recorded was added to the last opener's song.

So the note is now `served`, a map from session id to `{ ws, project }`, written by
`sendActiveProject` — the single funnel through which a project reaches the engine — and read by
session:

| asks | gets its session from |
|---|---|
| the socket's `open` re-send | the socket, which is per session |
| a `recorded` frame | the socket that delivered it |
| the poll's prewarm and reconcile | `sessionOf(req.ws)` |
| the idle prune's "do not drop this one" | every key in `served` |
| `unloadEngine`, `/engine/unload` | `sessionOf(req.ws)` |

And every remaining engine call takes its workspace as an argument — `ensureEngine(ws)` has no
default any more, which is the point: a caller that does not say cannot compile. `null` is still
allowed and still means the bare session, but it now has to be written down.

### What is legitimately global

The **PatternClock**, the strudel **file watcher**, and `clientDoc`, the document the turntables
surface hands over. Those are one running thing, not one per person: one project's patterns, one
watcher, one overlay. Several sessions can be served at once, but only the most recent one owns
the clock — last write wins, as it always did. What `clockWs` adds is that the clock's sends go
to *that* workspace's session instead of to a global set only by `/open`, so an overlay pushed
after a restart lands in the room the song is in.

`selectedEngineUrl` is global too, and that one is simply true: there is one engine.

## The engine may have forgotten, and only it knows

`served` is this process's note of what the ENGINE is serving, and the engine is a
different process that can restart under us. When it does — it crashed, the supervisor
respawned it — the new one holds no session at all, while the note still says we are serving
a project. Nothing then re-sends it: `prewarmEngineForActive` takes its early return on every
2 s `/workspace` poll precisely because the note is set. The browser shows a project the
engine has never heard of, and the transport does nothing, for ever, until an explicit
`/open`.

Measured, not reasoned: with the file service reporting `activeProject: 01.danse.l8`, the
engine reported `loaded=false, tracks=0` — and still did 45 seconds after a respawn, with the
poll running throughout. One `POST /open` brought back all 14 tracks.

So the socket's `open` re-sends the project this session was serving. A fresh socket is the
one moment we learn the engine may be fresh too, and it is cheap to act on: the engine DIFFS
what arrives, so reconnecting to an engine that still has the project answers "no changes
(project already current)".

## Asking, rather than remembering

The `open` re-send does not make `served` honest — it is still one process's belief
about another's state, and it only fires when a socket actually drops. A session emptied
*without* that still strands the project, and so does the worse case below.

So `prewarmEngineForActive` no longer takes an early return on the strength of the note. When
the note is set it **asks**: `list-sessions`, throttled to one question per
`RECONCILE_EVERY_MS` however many tabs are polling — and per SESSION, both the question and the
throttle. The old code threw away one poll on the strength of another's, and worse, refused to
start a workspace at all whenever some *other* session was already served: a second person's
poll matched neither branch and their project was never sent. There is nothing to fight over,
because the engine keeps one edit per session.

Two answers, two cures:

- **The engine is not holding the session** (absent, or `loaded: false`) — re-send it. Cheap
  for the same reason the `open` re-send is: the engine diffs.
- **The engine does not answer at all** — the link is a zombie. Re-sending cannot land on it,
  however many times it is tried, so the link is dropped and re-dialled; the fresh socket's
  `open` carries the project back.

That second case is not hypothetical either. Measured on 2026-08-14: the engine had been
replaced under a file service that had been up for 32 hours, whose socket was still
`ESTABLISHED` and whose link still reported `ready` — and which was inert in both directions.
`module list plugins` fired and timed out after 4 s having heard nothing (`[cmd] module list
plugins — ran=4023ms`; that verb is `system plugins list` now, and the log line is quoted as it
was), `POST /open` loaded nothing, and the engine reported `loaded=false,
tracks=0` on the very session the browser was pressing Play on. Nothing anywhere reported a
fault. Restarting the service fixed it instantly, which is exactly the cure a re-dial is.

Only `loaded` is compared, never *which* project: the wire carries a display name
(`"LEMO - DANSE"`) and this side holds a path, so comparing the two would invent mismatches.
Switching projects is `startEngineForActive`'s job.

And the compile-and-send itself no longer fails silently. `sendActiveProject` still swallows a
malformed project rather than failing the request — `/project-doc` and `/graph` are what
surface that to the browser — but it now says so on the console, because it is the one path
whose failure leaves the engine holding nothing at all.
