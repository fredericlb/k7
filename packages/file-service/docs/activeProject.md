# The active project — what the ENGINE is holding

A workspace is **one git repository**, made here or cloned, and it holds **several projects**.
The editor draws the whole of it; the *active* project is the one folder the engine is playing,
and choosing it is a gesture on screen. An app is still opened by an address rather than through
a picker (`packages/project-shell/docs/launch.md`), and that address may name the project — but
it does not decide alone, and it is not the only thing that can change it.

## The tree is the clone's, not the project's

`tree()` walks the **workspace root**, not the active project, because what the tree shows is what
you can choose from. A real repository holds far more than the song you opened — other projects, a
`_modules` library shared between them, mixdowns, an `orig/` full of `.dawproject` and `.als`
sessions — and showing all of it invites you to open a file belonging to a project that is not the
one playing. That is the point: a workspace is several songs, and the one the engine takes is
picked from the tree, on the ▶ that `FileTree.tsx` draws on every project row — filled for the
active one, hollow for the rest.

**Paths are workspace-relative**: `/file`, `/rename`, `/move` and `/folder` take strings rooted at
the workspace, the same root the walk starts from.

What the wider tree costs, and how each is paid:

- **A file may belong to a project that is not playing.** `projectPaths.ts`'s rules match on
  `(^|/)`, so `other.st0/clips/a.yaml` is a clip by every test there is — and looking its id up
  in the ACTIVE project's compiled doc answers with the wrong thing or with nothing.
  `inActiveProject()` is the predicate that stops it, and st0's editor gates its minimap item
  and its clip/sequence panel on it. Opening such a file gives you its TEXT, which is right: it
  is a file in this repository and you may read and edit it.
- **The shared `_modules` library is visible**, and ordinarily editable — a write there
  changes what every project in the workspace sees, which is the point of it being shared. What
  a project needs of it still arrives through `/module-catalogue`, `/module-ui` and `/hints`.
- **A `.dawproject` outside a project folder is on the tree**, and can therefore be clicked to
  import. That is a gain rather than a cost: importing lands a new project at the workspace root,
  which is exactly where the tree looks.

`workspaceTree()` is kept as an alias of `tree()`: `/workspace-tree` asks it of a workspace the
home page has not opened, which is a different question with the same answer.

## Opening a project that is not there

`isProjectDir` is a rule about a **name** — `mysong.st0`, `party.z0` — because the same
question is answered in places where no file can be opened at all
(`packages/web-protocol/projects.ts`). The trap is that a name rule says "yes" about a folder
that does not exist.

That is not hypothetical. The name a caller sends and the folders on this disk are learned at
different moments: rename a project folder, push, and whatever listed it can go on offering
the old name until it refreshes. A race is still a race, and a listing can be a fetch behind
at exactly the wrong second.

Without an existence check the sequence is:

1. `POST /open {path: "01_danse.st0"}` — accepted, because the *name* claims st0;
2. `activeProject` set to a path with nothing at it, and the `.studio-active` marker written,
   so a reload arrives broken too;
3. the first thing to compile it — `/project-doc` — reaches `@studio/song`'s `loadProject`,
   which finds no directory, falls through to "not a folder project", finds no `.yaml` either,
   and reports **`unsupported song '01_danse.st0' — use a .yaml file or a folder project`**.

Every word of that is true and none of it is the problem. So `setActiveProject` checks
existence **before** the name rule and says what actually happened, and `isProjectDir` itself
requires a directory — which also stops a stale `.studio-active` marker (a project deleted
outside the service) from being restored at construction.

## Whose project — the note is per SESSION

There is one engine and one link per session, so the note of what is being served — which
workspace, which folder — is per session too. One global note, written by `POST /open` and by
nothing else, is wrong in two directions at once, and each is silent.

**Null.** Between a file service restart and the next `/open` there is no current workspace, and
`sessionOf(null)` is the BARE service id — a session the engine holds nothing in. Everything
defaulting through it addresses that empty session: a preview, a transport, an arm, a document
the turntables surface built. The engine's `previewSample` returns without a word on an empty
session, so the ▶ button clicks and says nothing. Nothing is broken anywhere — the message goes
to an empty room.

**Somebody else's.** With two people on one file service a global note names whoever opened
last. Their sockets are separate (one per session, see `sessionOf`), so the other person's
reconnect compares itself to a session that is not theirs, declines to re-send, and leaves their
project stranded; a take they record is added to the last opener's song.

So the note is `served`, a map from session id to `{ ws, project }`, written by
`sendActiveProject` — the single funnel through which a project reaches the engine — and read by
session:

| asks | gets its session from |
|---|---|
| the socket's `open` re-send | the socket, which is per session |
| a `recorded` frame | the socket that delivered it |
| the poll's prewarm and reconcile | `sessionOf(req.ws)` |
| the idle prune's "do not drop this one" | every key in `served` |
| `unloadEngine`, `/engine/unload` | `sessionOf(req.ws)` |

And every engine call takes its workspace as an argument — `ensureEngine(ws)` has no default,
which is the point: a caller that does not say cannot compile. `null` is allowed and means the
bare session, but it has to be written down.

The strudel **file watcher** and the document a browser hands over are per session too. One
account plays two sessions at once — its song and its bench (`packages/engine-protocol/docs/sessions.md`)
— and a single watcher would stop the song's pattern edits reaching the engine the moment the bench
opened.

### What is legitimately global

`selectedEngineUrl`, and that one is simply true: an account's files drive one engine at a time,
which is why st0 opens the bench on the engine the account's song is already on
(`apps/st0/frontend/src/engineSession.ts`).

## The engine may have forgotten, and only it knows

`served` is this process's note of what the ENGINE is serving, and the engine is a
different process that can restart under us. When it does — it crashed, the supervisor
respawned it — the new one holds no session at all, while the note still says we are serving
a project. A poll that trusts the note re-sends nothing, so the browser shows a project the
engine has never heard of, and the transport does nothing, for ever, until an explicit
`/open`.

The signature is the file service reporting `activeProject: 01.danse.st0` while the engine
reports `loaded=false, tracks=0`, and going on reporting it a minute after a respawn with the
2 s `/workspace` poll running throughout. One `POST /open` brings every track back.

So the socket's `open` re-sends the project this session was serving. A fresh socket is the
one moment we learn the engine may be fresh too, and it is cheap to act on: the engine DIFFS
what arrives, so reconnecting to an engine that still has the project answers "no changes
(project already current)".

## Asking, rather than remembering

The `open` re-send does not make `served` honest — it is still one process's belief
about another's state, and it only fires when a socket actually drops. A session emptied
*without* that still strands the project, and so does the worse case below.

So `prewarmEngineForActive` does not take an early return on the strength of the note. When
the note is set it **asks**: `list-sessions`, throttled to one question per
`RECONCILE_EVERY_MS` however many tabs are polling — and per SESSION, both the question and the
throttle. A throttle shared between sessions throws away one poll on the strength of another's,
and a check that some *other* session is already served leaves a second person's poll matching
neither branch and their project never sent. There is nothing to fight over, because the engine
keeps one edit per session.

Two answers, two cures:

- **The engine is not holding the session** (absent, or `loaded: false`) — re-send it. Cheap
  for the same reason the `open` re-send is: the engine diffs.
- **The engine does not answer at all** — the link is a zombie. Re-sending cannot land on it,
  however many times it is tried, so the link is dropped and re-dialled; the fresh socket's
  `open` carries the project back.

That second case is not hypothetical either. An engine replaced under a long-lived file
service leaves a socket still `ESTABLISHED` and a link still reporting `ready`, inert in both
directions: `system plugins list` fires and times out after 4 s having heard nothing
(`[cmd] … — ran=4023ms` in the log), `POST /open` loads nothing, and the engine reports
`loaded=false, tracks=0` on the very session the browser is pressing Play on. Nothing anywhere
reports a fault. Restarting the service fixes it instantly, which is exactly the cure a re-dial
is.

### The third answer: it replies, and still never takes it

The two cures above assume the answer tells you which one you are in. It does not, and the case
that slips between them is the expensive one: a link that **answers `list-sessions` perfectly**
while every project sent over it lands nowhere. Measured once as **569 consecutive re-sends** —
`⚠ engine is not holding mymix.st0 — re-sending it`, five seconds apart, for the better part of
an hour, with the engine's own log showing not one `[client] connected` in that time. The first
cure kept firing because the session was genuinely not held; the second never fired because the
socket was answering. Nothing escalated, and nothing said so.

So a re-send now COUNTS. `RESEND_LIMIT` of them without the engine taking the project means the
socket is deaf rather than busy, and the link is dropped and re-dialled — the same cure as a
zombie, reached by a different symptom. The counter resets the moment the engine holds it.

Three, not one: a re-send that loses a race with an engine restart is ordinary, and re-dialling
on the first one would trade a rare wedge for a common churn. Three at `RECONCILE_EVERY_MS` is
fifteen seconds of patience before giving up on a socket, which is long against a restart and
short against an evening.

Only `loaded` is compared, never *which* project: the wire carries a display name
(`"LEMO - DANSE"`) and this side holds a path, so comparing the two would invent mismatches.
Switching projects is `startEngineForActive`'s job.

And the compile-and-send itself does not fail silently. `sendActiveProject` swallows a
malformed project rather than failing the request — `/project-doc` and `/graph` are what
surface that to the browser — but it says so on the console, because it is the one path
whose failure leaves the engine holding nothing at all. The note is taken FIRST and even when the
compile throws: a session serving a project the compiler currently refuses is still serving that
project, and both the reconcile and the socket's `open` need to know which one to try again with.

## One socket per session, and when it goes

`ensureEngine(ws)` opens ONE socket per session rather than one socket carrying several. The engine
would accept either — a session is a field on each message — but a socket per session gets each its
own outbox and its own reconnect, and the alternative is a shared queue where one user's backlog
delays another's transport.

It is deliberately **not a driver**. The engine counts sockets that declare `role: "driver"` on hello
and frees a project 45 s after the last one goes (`engine/st0-engine/docs/sessions.md`). This link is
held for as long as the machine is up, so counting it would mean no project ever looked abandoned —
which is the whole point of the count. Saying nothing is what keeps it out; there is no flag to pass.

`dropLink` **deletes before it closes**, and that order is the whole function: the close handler
re-dials unless the map no longer holds this client, so closing first leaves the outcome resting on
the close event being asynchronous. `tellEngine` also drops the SESSION, for when the work is
genuinely over; an idle prune does not, because the person may come back and their project should
still be loaded.

`pruneIdleLinks` exists because `links` only ever grows: a second person served by this file service
leaves the first one's socket open, and the close handler re-dials every second forever — so an
abandoned link is not merely a leaked socket but a permanent reconnect loop, and it keeps that
session alive on the engine as well. It never touches a session in `served`: one holding a project is
idle between commands by nature. That set is read off `served` rather than off one "current"
workspace, which would protect the last opener's session and reap everybody else's out from under a
project still loaded.

### The reconnect backoff's ceiling is LOCAL

`ENGINE_RECONNECT_MAX_MS` is 30 s and its own comment says why: "so a forgotten tab stops hammering
the relay". Neither half of that is true on this side. There is no forgotten tab — this is a service
dialling `127.0.0.1`, where a refusal costs one instant loopback connect rather than a sequential
dial of every address an engine ever advertised. And the engine restarts on every C++ save in the dev
session, so what the ceiling really buys is the delay before edits reach the audio again.

Taking the browser's number gives that delay up to thirty seconds, which reads exactly like the
engine ignoring your edit — the backoff is what a restart resets. Doubling still stops the 1 Hz
spin; the ceiling is what has to fit the distance, so `LOCAL_RECONNECT_MAX_MS` is 4 s. The jitter
on top is for the other half: several sessions dropped by one engine restart would otherwise come
back in lockstep. And a refused dial is not silent: with no trace at all, "the engine is off" and
"the engine is wedged" look identical from the logs.

On `open` the link also **replays the machine's preferences**: the audio device, then how that
interface's inputs are GROUPED. The order is load-bearing — opening a device rebuilds the wave
devices from scratch, so a pairing sent first would be thrown away.

## Waiting for one answer on a broadcast channel

Three of the engine's replies are broadcast rather than addressed, and each wait here has to pick out
its own answer and let go of its listeners whichever way it ends. A `once` listener never fires when
nothing arrives, so a stale one outlives its request and eats the following command's message.

- **`awaitArm`** matches on the TRACK. `armed` reaches every client in the session, so another
  surface arming a different track would otherwise resolve this wait with a frame that is not its
  answer, leaving the arm actually asked for waiting on a frame already consumed. Two
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

The middle one is where the interesting failures live: plugins that refuse to load are common —
twenty-seven on one real machine — and without the engine's `getLoadError` they arrive as the third
case, reported as plugins with nothing to offer when what they need is a licence. That makes the
answer to "why has this synth no parameters?" a fact about the plugin when it is a fact about the
machine, and sends nobody to look at the licence. A frame with no `found` at all reads as loaded: an engine
too old to send the flag answered, which it could only do by loading something, and defaulting the
other way would report every plugin on it as unloadable.

`PLUGIN_PARAMS_TIMEOUT_MS` is twenty seconds, against two for a session listing and four for the
cached plugin list. This one CONSTRUCTS the plugin — the only way to learn what it has — and a large
sampler or an Arturia synth takes seconds over it. The timeout is what stops a wedged plugin from
holding a request forever, not a latency budget.

### The window and the snapshot

`showNativePluginUIOf` is AWAITED. Returning as soon as `ensureEngine` hands back a client would
report an open window while the message sits in an outbox — that client's socket may never have
connected, since `send` buffers — or while a plugin load hangs inside the engine, and the one thing
the user sees is nothing at all. There is no reply that says "buffered", so the only sound test is
the engine saying it drew the window. `NATIVE_UI_TIMEOUT_MS` is generous — 30 s — because the honest
answer takes that long: the binary has to be loaded, and a big Arturia synth measures fourteen
seconds cold.

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
and the only place that answer can come from: the projects are folders on this disk
(`apps/st0/frontend/docs/projects.md`).

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
has just dropped is corrected within one tick. It answers in ADDRESSES rather than absolute paths — one
segment under the workspaces root, since there is no per-user level beneath it
(`packages/engine-client/docs/paths.md`); a workspace this machine cannot name in an address answers
null, because a row nobody could follow is worse than no row.

`/workspaces/by-repo` is the one that pairs with them: pl8 names a repo by its URI and knows nothing about
this machine's folders, so this is the question st0 asks before deciding whether anything needs cloning at
all. `POST /workspaces` is the ONE place a workspace is created on request — `getWorkspace` deliberately
refuses to, Examples aside.

## The strudel watcher carries almost nothing

`ignoreInitial` only silences the first events; chokidar still walks and remembers the whole tree, so a
project with a `media/` folder of takes has every one of them statted and held for the sake of a handful
of `.strudel` files.

`outsideTheWatch` is two rules, and the second is why it is not a blacklist of heavy folders. Directories
are pruned by `skip()` — the file service's own idea of what is not part of a project, so there is no
second list to keep in step and nothing a person could have authored inside one. FILES are kept only when
they are patterns, wherever they sit: that is what makes `media/` cheap without anyone having to predict
where a pattern is allowed to live. The two-call shape is chokidar 3's — a two-argument predicate is asked
once with the path alone and again with its `Stats` — and nothing may be ignored on the first call, or a
file would be dropped before its kind is known.

It re-sends the document only for a file a pattern LANE plays (`patternFiles`): a lane's pattern travels
IN the document, so a save is a recompile, and the engine applies the new source in place
(`engine/st0-engine/docs/patternPlugin.md`).

Narrowing it is the kind of change that fails SILENTLY: a pattern edit simply stops reaching the engine, and
nothing says why. So the predicate is tested rather than trusted, and a watcher that dies says so on the console —
unlike `moduleWatch`, this one has no walk-anyway ceiling to heal it.

A `watchModuleFolders` runs beside it for a different consumer: the strudel watcher RE-SENDS the song, that
one only lets `@studio/song` skip its stamp walk. It is closed by `forgetModuleWatch` unless somebody else
is still being served the same project — two people can have one shared project open, so "this session left
it" is not "nobody is on it". Closing it under them would cost them the fast path and nothing else, but
leaving it open when the folder is about to be renamed is the failure that matters: on Windows a handle
inside a directory is what makes its parent refuse a rename.

## The document a browser hands over

`clientDocs` holds, per session, a document a BROWSER built, in force until the project changes underneath it. The
turntables surface is the one thing that makes one: it takes this project's compile and fills the
decks' clips into it. It hands that over here rather than pushing it out of the browser's own socket,
because two writers for one engine — the service pushing the compile from disk, the surface pushing
the compile-with-decks — means whichever wrote last wins. One socket and one rule, both in
`engineLink.ts` (`packages/song/docs/surfaces.md`).

It goes out through `sendDoc`, the same call the disk-driven push makes, which is what makes it one
path rather than two. The engine diffs, so a song already playing keeps playing under it. `applyClientProject` takes the
requesting workspace for the same reason `enginePreview` does — the surface can hand over a
deck-filled document before anything has opened a project on this service, and without it that
document would go to the bare session and never be heard.

While a browser holds the document, `pushProject` does not send the compile: it would push the
bare compile — the same project with the decks' clips gone — and the surface would blink empty until
its next gesture. The browser polls `/revision`, rebuilds from the fresh compile and hands its own
back, so the new state arrives complete instead of arriving twice. Two things override it: an
explicit `reload`, because somebody asked for what is on disk and answering "no, a surface has the
engine" would refuse the one command that exists to force this; and switching project, because a
document built for the project being LEFT must not survive into the next one.

`sendDoc` takes the workspace and the document together: a document sent without its workspace goes to
the bare session, which after a restart is the empty room.

## What a command run answers

`CommandOutput` is an array with a `refused` flag on it rather than a `{ lines, refused }` pair:
every writer already pushes into it, and a reply is one verdict, since a handler that refuses
returns. The flag is optional, so "did not refuse" and "no verdict yet" are the same absence, which
is what they are. The first refusal a caller meets is "no project open"; without the flag it reads as
ordinary output.

`WebCommandRun` carries the lines, the revision either side of the write, and which files it wrote.
All three are `recordChange`'s, passed straight through: it brackets the mutation and walks the tree
twice to journal it, so it can name both instants and both images for nothing. The route needs them
for three things and takes no walk of its own for any — whether the project CHANGED
(`after !== before`), the token it hands the browser so the poll has nothing left to say, and the file
list a client scopes its reload on. On a command refused before it started the two instants are one
and the file list is `[]`, not `null`: the empty list is the truth, where "not known" would send a
client off to re-ask everything.

The host is built per request. The module vocabulary reads every module file (~1 s) and only
`create module` needs it, so `baseModules` is a memoised getter — loaded at most once per request and
not at all for a mixer move. `stemsChain` is read per request too, so a `system stems` in one tab is
in force in the next command without anything being told. Every engine call names the workspace: a
command knows whose it runs in, and defaulting instead sends transport and arm to the bare session.

`runColdStep` — `clip process` over a chain that SEPARATES — goes through the job registry rather than
calling the worker directly, for the two properties a bare call has not: the id hashes the WORK, so a
retry or a second tab joins the run in flight instead of starting another hour of arithmetic, and the
inference sits in a worker thread, so the service goes on answering `revision()` and serving files
while it runs. It is awaited, which keeps the command's promise at the price of one HTTP request
staying open for minutes; that is the shape the verb has, and a person watching a separation has
nothing else to do with the tab. A job forgotten between two polls is said as itself rather than as a
failed separation — the registry keeps a finished job for five minutes, and the files may well be on
disk.

### A reload is held to the end of the run

`reload` in a web run does not compile. It names the project in `HeldPush`, and the run sends it
after `recordChange` has closed — inside ONE `withModuleStamp` scope that also builds the graph the
reply carries, under the `after` token the route used to seed the graph with on its own. A writing
command is exactly the case the module cache cannot keep: its write moved the stamp less than two
seconds ago, so each derivation that reads the vocabulary rebuilds it, and the compile and the graph
used to be two. On `01.danse.st0` a kit preset through the route went from 1.21 s to 0.95 s of server
time, and every reloading verb pays the same toll.

The scope must open after the last write, never before: verbs write with `fs` beside the service, and
a scope taken before a write would serve the vocabulary from before it (`packages/song/docs/moduleCache.md`).
`recordChange` returning is the first point the service KNOWS the writing is over — which is why the
push waits for it rather than for the verb's own `reload` call.

What the engine sees does not move. Every engine call a verb makes after its reload — transport, arm,
the plugin and device listings — flushes the held push first, so the document still arrives before
anything that depends on it. A whole document the verb sends itself (`applyProject`, `sendProject`)
CANCELS the held one instead: sent after it, the older compile would be the one left playing.
`heldReload.test.ts` pins that a reloading run reaches the engine once, with what it wrote, before it
answers.

## `GLOBAL_COMMAND` is a copy, and it drifts

The verbs that need no active project — the rig preferences, the workspace's set lists, and the whole-repo
git ones — are matched by one regular expression, and it is a copy of names that live in `commands.yaml`.
Check the catalogue before adding to it.

Two ways it falls out of step, both silent. A bare `commit|pull` matches NEITHER `project commit` nor
`project pull`, so both are refused with "no project" whenever none is open — invisible from st0's command
bar, which always has one, and met by a caller that creates a project it never opens. And a rig verb
listed under a head it no longer carries (`channel` or `audio`, where the verb is `system channel …`) is
refused from a workspace with no project open, which is the one place a rig setting is most likely to be
changed.
