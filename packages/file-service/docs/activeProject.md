# The active project — what st0 and m9 are actually looking at

A workspace is **one git clone**. The project is one folder inside it. Those used to be
almost the same thing, because st0 owned the level above a project and let you pick one; now
pl8 owns the repositories and opens an app **on** a project
(`packages/project-shell/docs/launch.md`). That change moved two questions here.

## The tree is the project's, not the clone's

`tree()` walks the **active project**, not the workspace root.

A real repository holds far more than the song you opened: other projects, a `_modules`
library shared between them, mixdowns, an `orig/` full of `.dawproject` and `.als` sessions
the songs were imported from. Rooting the tree at the clone shows all of it, which reads as
"st0 is showing me the repository" — and it invites you to open a file belonging to a project
that is not the one playing.

**Paths stay workspace-relative.** Only the root of the walk moves; `/file`, `/rename`,
`/move`, `/folder` are untouched and still take the same strings they always did. That is
what makes this a one-line change rather than a re-rooting of the whole API.

Two consequences worth knowing:

- With **no** active project the tree is the workspace, which is also what a lone-project
  workspace answers (its root *is* the project). Nothing regressed for either.
- The shared `_modules` library is no longer browsable as text from st0. It never was
  editable — `guardShared` refuses every write, and a UI edit forks a project-local copy —
  and the médiathèque is where the catalogue is authored. What a project needs of it still
  arrives through `/module-catalogue`, `/module-ui` and `/hints`, which are unaffected.
- A `.dawproject` sitting **outside** the project folder is likewise off the tree, so it can
  no longer be clicked to import. Importing lands a *new* project at the workspace root,
  which st0 cannot open by itself anyway — you go back to pl8 for that either way.

## Opening a project that is not there

`isProjectDir` is a rule about a **name** — `mysong.st0`, `myset.m9` — because pl8 must
answer the same question from a bare blobless mirror where no file can be opened
(`packages/web-protocol/projects.ts`). The trap is that a name rule says "yes" about a folder
that does not exist.

That is not hypothetical. pl8 reads a **mirror**, the file service reads a **clone**, and the
two are fetched at different moments. Rename a project folder, push, and pl8 will keep
offering the old name until its mirror is refreshed — pl8's own fix for that is in
`apps/pl8/backend/src/routes/projects.ts`, whose repository listing now refreshes the mirrors
it lists, not just the tree view. But a race is still a race, and the mirror can be a fetch
behind at exactly the wrong second.

Without an existence check, that produced this sequence:

1. `POST /open {path: "01_danse.st0"}` — accepted, because the *name* claims st0;
2. `activeProject` set to a path with nothing at it, and the `.studio-active` marker written,
   so a reload arrived broken too;
3. the first thing to compile it — `/project-doc` — reached `@studio/song`'s `loadProject`,
   which found no directory, fell through to "not a folder project", found no `.yaml` either,
   and reported **`unsupported song '01_danse.st0' — use a .yaml file or a folder project`**.

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
empty session, so the ▶ button clicked and said nothing; `st0 play` did nothing and reported
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

Measured, not reasoned: with the file service reporting `activeProject: 01.danse.st0`, the
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
whose failure leaves the engine holding nothing at all. The note is taken FIRST and even when the
compile throws: a session serving a project the compiler currently refuses is still serving that
project, and both the reconcile and the socket's `open` need to know which one to try again with.

## One socket per session, and when it goes

`ensureEngine(ws)` opens ONE socket per session rather than one socket carrying several. The engine
would accept either — a session is a field on each message — but a socket per session gets each its
own outbox and its own reconnect, and the alternative is a shared queue where one user's backlog
delays another's transport.

It is deliberately **not a driver**. The engine counts sockets that declare `role: "driver"` on hello
and frees a project 45 s after the last one goes (`engine/moteur/docs/sessions.md`). This link is
held for as long as the machine is up, so counting it would mean no project ever looked abandoned —
which is the whole point of the count. Saying nothing is what keeps it out; there is no flag to pass.

`dropLink` **deletes before it closes**, and that order is the whole function: the close handler
re-dials unless the map no longer holds this client, so closing first leaves the outcome resting on
the close event being asynchronous. `tellEngine` also drops the SESSION, for when the work is
genuinely over; an idle prune does not, because the person may come back and their project should
still be loaded.

`pruneIdleLinks` exists because `links` only ever grew: a second person served by this file service
left the first one's socket open, and the close handler re-dials every second forever — so an
abandoned link was not merely a leaked socket but a permanent reconnect loop, and it kept that
session alive on the engine as well. It never touches a session in `served`: one holding a project is
idle between commands by nature. That set is read off `served` rather than off one "current"
workspace, which protected the last opener's session and reaped everybody else's out from under a
project still loaded.

### The reconnect backoff's ceiling is LOCAL

`ENGINE_RECONNECT_MAX_MS` is 30 s and its own comment says why: "so a forgotten tab stops hammering
the relay". Neither half of that is true on this side. There is no forgotten tab — this is a service
dialling `127.0.0.1`, where a refusal costs one instant loopback connect rather than a sequential
dial of every address an engine ever advertised. And the engine restarts on every C++ save in the dev
session, so what the ceiling really buys is the delay before edits reach the audio again.

Taking the browser's number gave that delay up to thirty seconds where it had been one, which reads
exactly like the engine ignoring your edit — the backoff is what a restart resets. Doubling still
stops the 1 Hz spin; the ceiling is what has to fit the distance, so `LOCAL_RECONNECT_MAX_MS` is
4 s. The jitter on top is for the other half: several sessions dropped by one engine restart would
otherwise come back in lockstep. And a refused dial is no longer silent — it used to leave no trace
at all, which is how "the engine is off" and "the engine is wedged" came to look identical from the
logs.

On `open` the link also **replays the machine's preferences**: the audio device, then how that
interface's inputs are GROUPED. The order is load-bearing — opening a device rebuilds the wave
devices from scratch, so a pairing sent first would be thrown away. And the pattern clock is told to
forget what it believes the engine holds BEFORE anything is re-sent, so the first emit after a fresh
socket is a whole document and not a delta aimed at a project that is not there.

## Waiting for one answer on a broadcast channel

Three of the engine's replies are broadcast rather than addressed, and each wait here has to pick out
its own answer and let go of its listeners whichever way it ends. They were `once` listeners, which
never fire when nothing arrives: the stale one outlived the request and ate the following command's
message.

- **`awaitArm`** matches on the TRACK. `armed` reaches every client in the session, so another
  surface arming a different track used to resolve this wait with a frame that was not its answer —
  and then the arm actually asked for waited for a frame already consumed, and timed out. Two
  surfaces arming at once is not exotic; the timeline's `a` button and `rec` are two. On a timeout it
  names both remaining states: "engine did not answer" alone could not tell a dropped link from a
  silent engine, and the engine prints its own `[rec]` line either way, so saying which half to look
  in is the difference between a report and a dead end.
- **`awaitSessions`** takes the same shape. Its reply is engine-GLOBAL and carries no session, so it
  passes every client's filter (`forSession` in `packages/engine-protocol/sessions.ts`).
- **`awaitPluginParams`** matches on the id, and the hazard is one notch worse: `plugin-param-list`
  is engine-global too, and the question takes SECONDS — exactly long enough for a second one to be
  asked. What is built from the answer is a module's whole panel, so taking somebody else's reply
  would write one plugin's knobs into another plugin's file, with nothing saying so. Resolving on the
  first frame to arrive would draw Diva's panel into Serum's `ui.yaml`.

### Three outcomes, not two

`PluginParamAnswer` exists because flattening them is what made the shape necessary. `undefined` from
the wait is "the engine never answered"; `found: false` is "it answered, and this machine cannot
find, create or LOAD that plugin"; `found: true, params: []` is "it loaded and publishes none".

The middle one is where the interesting failures live: twenty-seven plugins on the machine this was
written on refuse to load, and until the engine checked `getLoadError` they arrived as the third case
— reported as plugins with nothing to offer, when what they need is a licence. So the answer to "why
has this synth no parameters?" was made a fact about the plugin when it is a fact about the machine,
and nobody was sent to look at the licence. A frame with no `found` at all reads as loaded: an engine
too old to send the flag answered, which it could only do by loading something, and defaulting the
other way would report every plugin on it as unloadable.

`PLUGIN_PARAMS_TIMEOUT_MS` is twenty seconds, against two for a session listing and four for the
cached plugin list. This one CONSTRUCTS the plugin — the only way to learn what it has — and a large
sampler or an Arturia synth measured seconds of that. The timeout is what stops a wedged plugin from
holding a request forever, not a latency budget.

### The window and the snapshot

`showNativePluginUIOf` is AWAITED, and it did not used to be. It returned true the moment
`ensureEngine` handed back a client — which it does whether or not that client's socket has ever
connected, since `send` buffers. So a click reported an open window while the message sat in an
outbox, or while a plugin load hung inside the engine, and the one thing the user saw was nothing at
all. There is no reply that says "buffered", so the only sound test is the engine saying it drew the
window. `NATIVE_UI_TIMEOUT_MS` is generous — 30 s — because the honest answer takes that long: the
binary has to be loaded, and a big Arturia synth measured fourteen seconds cold.

`snapshotPluginBase` is awaited for a different reason, and the difference is what there is to say. A
window either appears on somebody's screen or does not, and no reply helps; a snapshot either produced
a file or produced nothing, and which one decides whether the caller may tell the user a base exists.
Its timeout is short — nothing is LOADED, the instance is already open, so it is a state read and a
small file.

In all three, `undefined` and `{ok: false}` must not arrive spelt the same way: both leave nothing
behind, and only the second has anything to say about why.

## The machine's own questions have no workspace

`/plugins`, `/plugin-params` and `/plugin-native-ui` are asked on the BARE session, deliberately.
Which plugins exist, what they have, and what they look like are facts about the MACHINE, exactly
like the scan cache they come out of. The médiathèque asks them while no project is open at all — it
edits a library — and routing them through a session would send them to a room the engine holds
nothing in. `pluginParams` skips the `isReady` check the arm and the session listing make, because it
is the FIRST thing to want the bare session on many machines and routinely arrives while the socket is
still dialling; `send` buffers until open, so asking anyway is what makes the first click work.

`/plugins` answers two shapes of the same list and both are used: `pluginNames` is what a name-matching
field needs, and `plugins` carries the role and the plugin's own category, which is what decides a
module's PORTS and where it is filed. `/plugin-params` takes `format` and `id` together because `id`
is the binary's path: a display name can belong to two formats of one plugin, and the engine resolves
the pair, not the name. It answers 503 rather than an empty list when the engine cannot be reached —
the caller writes a panel from what comes back, and an empty one is a REAL answer.

The native-UI instance is an ORPHAN — no track, no session, no project — and nothing it is told is
saved. That is what makes it safe to open while something is playing, and it is also the limit worth
saying out loud: it is somewhere to LOOK at a plugin, not somewhere to set one. Values still belong in
the module's text. The window opens on THIS machine's screen, which is the engine's, so a browser on
another machine will be told the request succeeded and see nothing — a native plugin UI is a native
window, and it draws where the plugin is loaded.

## The three workspace-less listings

`/workspaces`, `/workspaces/projects`, `/workspaces/surfaces` and `/engine/served` are registered
BEFORE `resolveWorkspace`, because the user is the whole question and no workspace is open when they
are asked.

`/workspaces/projects` is every workspace on this machine and the projects in it — st0's home page in
one call. A LIST route rather than one call per workspace, because the page draws them all and N round
trips over the LAN would be N waits for one screen. It is the machine answering "what projects exist",
which is now the only answer there is: pl8 held a bare blobless mirror of every repository to answer it
from the hosted side, and `apps/st0/frontend/docs/projects.md` says why that copy went.

`/workspaces/surfaces` is the same list narrowed to what a SECOND DEVICE could open — every project
that declares a surface, flat, with those surfaces and which one the workspace has open. That is st0's
`/external` page in one call, and for the same reason: the page is a menu on a tablet, and a round trip
per project would be a menu that fills in row by row.

`/engine/served` says which ONE of those the engine is actually holding for this person. The menu above
lists every project on the disk that declares a surface; this says which of them a second device can
reach without moving the engine off something. A session is per service and per person, so the answer is
one project for the whole account — not one per workspace, which is what the `.studio-active` markers are
and why they cannot answer this (`packages/engine-protocol/docs/sessions.md`).

`servedProject` is a belief about another process, like every other read of `served`: the engine can have
restarted under us. It is not worth asking `list-sessions` here — the poll that owns that question is
`prewarmEngineForActive`, throttled and running anyway, and a menu that briefly names a project the engine
has just dropped is corrected within one tick. It answers in ADDRESSES rather than absolute paths, built
from the slug the same way `sessionOf` builds one from a workspace root; a workspace this machine cannot
name in an address answers null, because a row nobody could follow is worse than no row.

`/workspaces/by-repo` is the one that pairs with them: pl8 names a repo by its URI and knows nothing about
this machine's folders, so this is the question st0 asks before deciding whether anything needs cloning at
all. `POST /workspaces` is the ONE place a workspace is created on request — `getWorkspace` deliberately
refuses to, Examples aside.

## The strudel watcher carries almost nothing

`ignoreInitial` only silences the first events; chokidar still walks and remembers the whole tree, so a
project with a `media/` folder of takes had every one of them statted and held for the sake of a handful
of `.strudel` files.

`outsideTheWatch` is two rules, and the second is why it is not a blacklist of heavy folders. Directories
are pruned by `skip()` — the file service's own idea of what is not part of a project, so there is no
second list to keep in step and nothing a person could have authored inside one. FILES are kept only when
they are patterns, wherever they sit: that is what makes `media/` cheap without anyone having to predict
where a pattern is allowed to live. The two-call shape is chokidar 3's — a two-argument predicate is asked
once with the path alone and again with its `Stats` — and nothing may be ignored on the first call, or a
file would be dropped before its kind is known.

Narrowing it is the kind of change that fails SILENTLY: a pattern edit simply stops reloading, and nothing
says why. So the predicate is tested rather than trusted, and a watcher that dies says so on the console —
unlike `moduleWatch`, this one has no walk-anyway ceiling to heal it.

A `watchModuleFolders` runs beside it for a different consumer: the strudel watcher RELOADS patterns, that
one only lets `@studio/song` skip its stamp walk. It is closed by `forgetModuleWatch` unless somebody else
is still being served the same project — two people can have one shared project open, so "this session left
it" is not "nobody is on it". Closing it under them would cost them the fast path and nothing else, but
leaving it open when the folder is about to be renamed is the failure that matters: on Windows a handle
inside a directory is what makes its parent refuse a rename.

## The document a browser hands over

`clientDoc` is a document a BROWSER built, in force until the project changes underneath it. The
turntables surface is the one thing that makes one: it takes this project's compile and fills the
decks' clips into it. That used to go straight out of the browser on its own socket, which made two
writers for one engine — the service pushing the compile from disk, the surface pushing the
compile-with-decks — and whichever wrote last won. Now there is one socket and one rule, both in
`engineLink.ts` (`packages/song/docs/surfaces.md`).

It becomes the pattern clock's BASE, which is what makes it one path rather than two: a strudel lane
still overlays its events, and the actual `sendProject` is the same call the disk-driven push makes.
The engine diffs, so a song already playing keeps playing under it. `applyClientProject` takes the
requesting workspace for the same reason `enginePreview` does — the surface can hand over a
deck-filled document before anything has opened a project on this service, and without it that
document went to the bare session and was never heard.

While a browser holds the document, `loadPatternsFor` does not re-base the clock: it would push the
bare compile — the same project with the decks' clips gone — and the surface would blink empty until
its next gesture. The browser polls `/revision`, rebuilds from the fresh compile and hands its own
back, so the new state arrives complete instead of arriving twice. Two things override it: an
explicit `reload`, because somebody asked for what is on disk and answering "no, a surface has the
engine" would refuse the one command that exists to force this; and switching project, because a
document built for the project being LEFT must not survive into the next one.

`setClockProject` takes the workspace and the document together or not at all: the clock sends from
inside `setBaseProject`, so a base set without an owner goes wherever the previous one went — which
after a restart is the bare session, the empty room.

## What a command run answers

`CommandOutput` is an array with a `refused` flag on it rather than a `{ lines, refused }` pair:
every writer already pushes into it, and a reply is one verdict, since a handler that refuses
returns. The flag is optional, so "did not refuse" and "no verdict yet" are the same absence, which
is what they are. The first refusal a caller meets is "no project open" — it read as ordinary output
for as long as everything did.

`WebCommandRun` carries the lines, the revision either side of the write, and which files it wrote.
All three are `recordChange`'s, passed straight through: it brackets the mutation and walked the tree
twice to journal it, so it can name both instants and both images for nothing. The route needs them
for three things and used to take a walk of its own for each — whether the project CHANGED
(`after !== before`), the token it hands the browser so the poll has nothing left to say, and the file
list a client scopes its reload on. On a command refused before it started the two instants are one
and the file list is `[]`, not `null`: the empty list is the truth, where "not known" would send a
client off to re-ask everything.

The host is built per request. The module vocabulary reads every module file (~1 s) and only
`create module` needs it, so `baseModules` is a memoised getter — loaded at most once per request and
not at all for a mixer move. `stemsChain` is read per request too, so a `system stems` in one tab is
in force in the next command without anything being told. Every engine call names the workspace: a
command knows whose it runs in, and defaulting instead sent transport and arm to the bare session.

`runColdStep` — `clip process` over a chain that SEPARATES — goes through the job registry rather than
calling the worker directly, for the two properties a bare call has not: the id hashes the WORK, so a
retry or a second tab joins the run in flight instead of starting another hour of arithmetic, and the
inference sits in a worker thread, so the service goes on answering `revision()` and serving files
while it runs. It is awaited, which keeps the command's promise at the price of one HTTP request
staying open for minutes; that is the shape the verb has, and a person watching a separation has
nothing else to do with the tab. A job forgotten between two polls is said as itself rather than as a
failed separation — the registry keeps a finished job for five minutes, and the files may well be on
disk.

## `GLOBAL_COMMAND` has drifted twice

The verbs that need no active project — the rig preferences, the workspace's set lists, and the whole-repo
git ones — are matched by one regular expression, and it is a copy of names that live in `commands.yaml`.

It has fallen out of step twice. It listed a bare `commit|pull`, which matches NEITHER `project commit` nor
`project pull`, so both were refused with "no project" whenever none was open; it went unnoticed because
st0's command bar always has one, and pl8 creating a project it never opens is the first caller to arrive
without. And it listed `channel` and `audio`, the old spellings of the rig verbs, which have been
`system channel …` since the `system` head was introduced — so every one of them was refused from a
workspace with none open, which is the one place a rig setting is most likely to be changed. Check the
catalogue before adding to it.
