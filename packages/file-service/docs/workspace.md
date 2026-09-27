# workspace.ts — extended notes

The filesystem layer over ONE workspace root.

The file service serves many users' workspaces from one process, so `root`, the active
project and the compiled/waveform caches all live on a `Workspace` instance rather than in
module state, and the path-traversal guards (`safePath`/`toRel`) read `this.root`.

The active project is remembered per-workspace in a `.studio-active` marker file inside
the root (a dotfile, so it's hidden from the tree). Global machine preferences stay global
(`preferences.yaml`).

It is also what `tree()` walks, and what `setActiveProject` has to be strict about, since a
project can be named out of a listing this machine's clone is ahead of — both in
[activeProject.md](activeProject.md).

## `revision()` — the change token

A cheap token that CHANGES whenever the active project's sources do, so a client can poll
it instead of the expensive things that derive from them.

The one that pays for itself is the compile behind `/project-errors`, which the shell
asks for every 2 seconds whether or not anything has moved. Folding a file walk (~2ms)
in front of it turns a constant cost into one paid per edit.

**Three ingredients, because none is sufficient alone:**

- `mutations` — our own writes, so an edit through the API is reflected instantly, even
  inside a single filesystem-timestamp tick.
- the files — count + newest mtime over the project's files, so an edit made OUT of
  process (a `git pull`, another tab, an external editor) moves it too. There is no
  watcher here; this walk is what stands in for one.
- **two files outside the project**, folded into the same "newest mtime": the engine's scan
  cache (`<state>/exts.json`) and the machine's preferences (`<state>/preferences.yaml`).
  Every view keyed on this token reads one of them — `@engine/…` modules come out of the scan,
  a channel's label out of the preferences — and neither is in the project, so a plugin rescan
  or a `system channel set` would leave the memoised answers stale until an unrelated edit moved
  the token. Two stats on a walk of hundreds close that hole for every view at once, which is why
  they belong in the TOKEN rather than in each cache.

Deliberately NOT a content hash: reading every file would cost more than some of the
things this is meant to guard. Count+mtime misses a change that preserves both — in
practice an edit inside the same millisecond as another — and the mutation counter covers
the case we cause ourselves.

## What the token keys: both derived caches

`graphDoc()` and `cachedProjectDoc()` are memoised on it, and that is the whole
invalidation story — there is nothing else to remember to call.

Invalidating the compiled doc on our OWN writes alone — through `invalidateProjectDoc()` —
is correct for every edit that arrives through the API, and silently wrong for every edit
that doesn't. A `git pull`, an editor on the same disk, a tool writing the folder directly:
none of them touch the mutation counter, so the service would serve a compile of a project
that no longer exists, for the lifetime of the process. The symptom is the worst kind
available: the graph, the document sent to the engine and the error list all agree with each
other and all contradict the files on screen, and the only thing that fixes it is reopening
the project.

The cost is one directory walk per read where there would be none: 4.8 ms against the
~280 ms a graph build takes and the compile behind it, and the frontend pays that same walk
on every poll anyway. `invalidateProjectDoc()` stays — it bumps `mutations`, which is what
makes our own write visible inside a single timestamp tick.

The token describes the ACTIVE project. Both caches take a `dir` because building takes
one, not because a second project can sit in them.

`hints()` is the third, for the same reason: it is a pure read of the folder, and st0 asks for it
after EVERY command — the editor pane is mounted in every layout and refreshes its tree and its
completion vocabulary together, so a command that never touched a file the editor is showing
would still rebuild the tracks, the clips, the per-plugin params and the path map. 150 ms on a
real song, on the one process that is also compiling the answer to that command.

`projectErrors()`, `moduleCatalogue()`, `ioPorts()` and `baseModules()` are the rest, and they
go through one helper (`onRevision`) rather than four hand-written cache fields: the same token,
the same rule, and one place to read it. Each is otherwise a full read of the module vocabulary
on EVERY request — 21 to 43 ms, on routes a mounted panel asks for on each reload. `build` may
only READ; a builder that wrote would be memoising its own side effect away.

`projectDoc()` — the compiled song as the BROWSER wants it — is the same rule again, and it is the
most asked-for: three components are mounted for the app's life and each fetches it on the same
`reloadKey`, so one command means three full re-maps of every track, clip and note per tab, plus
three `JSON.stringify` of the whole song. `cachedVideoDoc()` is a SECOND cache rather than a branch
inside `cachedProjectDoc`, because the two compiles return different documents from the same folder
— a song has a tempo, its picture has a viewport — and both are warm at once for a song that carries
video, which is the ordinary case, picture being a song's own.

`surfaces()` is deliberately NOT cached: a project has none or a handful of small files, so the walk
is nothing, and a surface is edited exactly while somebody is looking at it — a cache keyed on the
revision would be right and would still be a thing to get wrong for no measurable gain.

`graphDoc()` and `projectErrors()` open TWO scopes, and both are the same idea one level apart. The
revision scope, because the derivation reaches `cachedProjectDoc` and asks for the token again; and
`withModuleStamp`, because a rebuild compiles the project (one walk) and then builds the graph
(another) — 19 ms each, both proving the module folders have not moved since the line before.
Measured on `projectErrors`: 48.5 ms without the stamp against 29 with it, and the 19 saved is one
walk, not one read — both reads are already cache hits. Neither writes, which is the permission the
stamp asks for.

`graphDoc(at)` builds the graph of a folder OTHER than the open project — a library chain, for the
builder. The token describes the ACTIVE project, so for anything else there is nothing honest to key
on and it is simply built.

### The two re-entrant scopes

`withRevision` holds one token for the duration of ONE derivation. `graphDoc()` asks for it, then
calls `clipExtents()` → `cachedProjectDoc()`, which asks again: unscoped that is two full walks per
`GET /graph` on a total cache HIT, and four for `POST /command`. Each is the 4.8 ms quoted above,
spent proving nothing has changed since the last one, microseconds earlier. It is re-entrant rather than
plumbed through the request because the nesting is already synchronous: the outermost derivation
opens the scope and the inner ones find it open, exactly the shape `withModuleStamp` has in
`@studio/song`. `/revision` itself is unaffected — it is polled outside any scope and still walks.

Its `seed` is a token the caller ALREADY holds, taken microseconds earlier and after the same write:
`POST /command` gets one out of `recordChange`, which walked the tree to journal the mutation and can
name the instant it finished for nothing. Only ever a token this class produced — a caller inventing
one would be keying every memo under it on a lie.

`withWalk` is the same shape over the file list rather than the token, and nothing inside it may
WRITE: the whole promise is that every reader describes the same instant. `WalkedFile` carries what
the three readers want from ONE `statSync` rather than one apiece — and `binary` and
`source` are not the same question, since a `.yaml` is a source and text, a `.md` is text and not a
source, and a `.wav` is neither. It deliberately carries no workspace-relative path although both
journal readers want one: computing it is `relative()` plus a separator pass, and the token wants
none of it — putting it in costs the two-second poll ~1 ms of arithmetic for 186 files it is only
going to count.

`Recorded<T>` rides the two tokens and the file list back out of `recordChange` for the same reason:
it is the one thing that BRACKETS a write and walks the tree twice to diff it anyway, so naming the
two instants costs a filter over a list it already has. `files: null` is a distinct answer from `[]`
and the distinction is load-bearing — a caller skipping work on "nothing of that kind changed" must
not read a failed diff as one.

## `recordChange` re-reads only what moved

The undo journal diffs the project's text files before and after a mutation, which is two
whole-folder walks per command — 180 small YAML files read 360 times to journal the one line a
command rewrote. The "before" image is also almost always the "after" image of the command
before it.

So `textOf` keeps the last walk's content, keyed by path, beside each file's size+mtime, and
re-reads only the files whose stamp moved. The gate is the one `binOf` has always trusted for
binaries; the walk itself still happens, so a file created or deleted out of band is still seen.

The walk is ONE walk. `textOf` and `binOf` split the same tree between them and `revision()` wants
it a third time for the token; crossed separately that is six passes per writing command, since the
journal takes an image either side of the mutation and the route a token either side of the
command. `walkProject` does it once and reports every file's
`size`/`mtime`/`binary`/`source`; `withWalk` holds that list for one phase, exactly as
`withRevision` holds the token and for the same reason; and `recordChange` hands its caller the
token of both instants, so the route walks not at all. 31–34 ms → 16 ms on a real song, with the
token identical to the character. Two things that must stay true, and are tested
(`revisionWalk.test.ts`): the narrow walk `/revision` takes and the wide one a mutation takes
must produce the SAME token, and the two-second poll must not start paying for a folder of wavs —
which is what `sourcesOnly` is, and why no workspace-relative path is computed on that path.

`diffBin` has a sharper version of the same problem: reading every binary's bytes BEFORE deciding
whether the diff can use them means a song with 650 MB of takes in `clips/` reads all of it to
journal one line of YAML, on every command. The bytes are read only for a file the mutation
created, or one it snapshotted — which is exactly the set the journal can act on.

## Listing the projects a workspace holds

`projectDirsUnder` scans for directories whose NAME claims an app, at any depth, workspace-relative.

It is its own scan rather than a pass over a `FileNode` walk: that builds an object per FILE and
throws the tree away to keep a handful of directory paths — 30.7 ms a pass on a real workspace
against 5.3 here. It `skip()`s exactly what the tree does, so what this answers and what a tree
draws cannot disagree, and it sorts by name at each level, which is what makes two calls
comparable: a listing that reordered itself between polls would redraw for nothing. An unreadable
folder yields no projects rather than a throw — raising would fail a whole poll over one directory
nobody could have opened anyway.

**A project inside a project is descended into and reported.** Nesting one is not the ordinary
arrangement, but an `.st0` set living inside another `.st0` song is a real one, and picking an
outermost winner would hide the inner one with nothing on screen to say so.

### The five-second window on `workspaceInfo().projects`

`workspaceInfo` is polled every two seconds by every tab, and what the poll actually WANTS is
`activeProject` (another tab switched) and `lastTake` (a recording landed) — both free. `projects`
is the expensive field by three orders of magnitude: 721 directories on a real workspace, 26 ms,
to answer a question whose answer changes when somebody creates a project.

So it is rescanned when this service MOVED one — `forgetProjects()`, said by the three methods that
create, import or recycle a project — and otherwise at most every five seconds. Deliberately NOT
the revision token: that one describes the ACTIVE project, and a project appearing beside it does
not move it; and every file write bumps the mutation counter, which would throw the scan away
thirty times while you type to re-find the same five folders.

The window covers what those three cannot see: a folder created on disk by a hand outside this
process, or arriving in a `git pull`. `cachedProjectDoc` refuses that trade and has to — a stale
COMPILE is confidently wrong about a song. A project list five seconds behind is a picker that has
not noticed a folder yet, which is a wait, not a lie.

## The two path gates

`safePath` resolves a workspace-relative path or throws, through two checks, both needed:

1. the **lexical** one — `resolve` + prefix — which catches `../` without a syscall;
2. a **realpath** check, because `resolve` does not follow symlinks. A symlink planted in the
   workspace (by an unzip, a git checkout, a CLI run) pointing at `~/.ssh` passes gate 1 happily,
   and `GET /file?path=link/id_rsa` would read straight through it.

The trap in gate 2 is that `realpathSync` throws ENOENT for a path being CREATED, which would break
every write to a new file. So it realpaths the nearest ancestor that exists and re-attaches the
rest: a component that does not exist yet cannot be a symlink, so nothing is lost by not resolving
it. An unreadable ancestor falls back to the lexical answer, which has already passed.

`guardShared` sits on top for STRUCTURE: `_modules` is shared by every project in the workspace,
so its files are edited in place and never renamed, moved or deleted through the routes that do
that elsewhere in the tree — a module's identity is its folder, and a rename or a move would
silently repoint every ref naming it. Content writes are ordinary; `module populate` rebuilds the
catalogue from the plugin scan the same way any other writer would. It is enforced here rather
than in the UI because the routes are reachable without one. `guardMutable` adds the root, the
recycle bin and the active project's own folder; anything INSIDE that folder is fair game.

## What the browser is handed

### A clip's extent when the document states none

`length: 0` on a `ClipDoc` means "to the end of the source" — a duration the compiler will not open
a wav to learn, and which the ENGINE fills in from the file it holds. Passed to the browser
unchanged it means nothing anyone can act on: a browser may not resolve a path on this machine, let
alone read a header. The timeline then falls back to drawing one bar, and a consolidated event
plays its three bars while being drawn as one.

`naturalBeats` answers it HERE because this is the only side that can: the service runs on the
machine with the audio. Nothing is written into the song for it — the file's length is the file's,
and copying it into a `to:` would be a cache that goes stale the moment `clip process` repoints
`source:` at a processed wav of a different length. It measures from the in-point, since that is
where the drawing starts, and answers 0 when it cannot measure, which hands the browser back the
unstated case. `|| natural`, not `??`, because 0 is precisely the value that means "unstated".

`sourceSeconds` memoises the measurement on the file's IDENTITY — size + mtime — so a re-render at
the same path is a different file and gets measured again, while the ordinary case (sixty clips,
polled every two seconds, none of them touched) costs one `stat` each and no read at all. It is
deliberately not read from the `{source}.cache` sidecar next door, which holds the same number: that
one is an ENVELOPE, kept against a fingerprint the engine refreshes on its own schedule, and a
duration taken from a stale one would be the old file's. The wav header is the truth and it is 44
bytes in.

### The rest of the mapping

`toWebClip` is named rather than written inline where a lane's clips are mapped, because a lane's
TAKES hold the same thing and a take must draw identically to the arrangement it was — two copies
of the mapping is how the two would come to differ.

- **`sourceName` only**, never the path: a browser has no business resolving a path on the engine's
  machine.
- **`warped` / `warpOff`.** `warped` means "there is a map at play here", which a declined one is
  not — so an event with warping switched off draws the icon CROSSED rather than lit, and `warpOff`
  is what says which.
- **`fadeIn` / `fadeOut` as `|| undefined`.** The compiler produces them for every event. A zero fade
  is no fade, and sending one would make every untouched event carry two explicit zeroes on a
  document polled every two seconds.
- **`vel` only when the file SAID one.** The compiler defaults it to 1, and passing that through
  would make every note look explicitly full — which is what a roll's velocity line has to tell
  apart from a note that states nothing.
- **`event` straight through** — the one part of the object that is not the placement and its
  material resolved together, and so the only part a paste can write back.
- **`mixer` is level and pan only.** The strip's three tone bands are still the mixer module's
  params; they are read and written where the module's other params are, which is the one place
  that cannot disagree with itself. Spread in, so a track with no strip has no `mixer` key rather
  than one full of zeroes that look like settings.

### Auditioning plays the clip's own window

`resolvePreview` on a `clip` returns `sourceFrom`/`sourceTo`, not the whole file. A `{0, 0}` plays
the file end to end, which for a take trimmed down to one bar of a five-minute pass means the ▶
says nothing about the clip you are looking at. Those two are the
compiler's own answer in file seconds, timecode spelling already resolved, and on a placement they
are the material's window already narrowed by the event's. A `to` that is absent — or not past the
in-point, which is what an empty intersection leaves — stays a length of 0: the engine reads that as
"to the end of the file", and it is the only honest thing to say about an extent nobody here has
opened the wav to measure.

## The libraries beside the project

`tree()` shows the SONG, not the repository around it, so everything a project can REACH needs its
own answer: none of them can be read out of that tree.

- **`moduleLibraries()`** — the roots come from `@studio/song` (the project's own `modules/`, then
  `moduleLibraryDirs`), so this lists what the LOADER resolves against and cannot drift from it.
  Each carries the namespace `moduleNamespaceOf` gives it, which is the word a chain writes. A root
  that is not there is still REPORTED, with `exists: false` and no nodes: a level you could put a
  module in is a real answer, and the surface offers to create one. Leaving it out would make "no
  library" and "an empty library" look the same when only one of them can be fixed by adding a
  module.
- **`@engine` is the odd one.** Every other level is a FOLDER; this one is synthesised from
  `<state>/exts.json`, so there is no path, no file to open and nothing to write. Its type folders
  are synthesised too — a ref is flat (`@engine/nam`), and two hundred and fifty plugins in one list
  is a level nobody can find anything in — so the folder rows carry a made-up path and the LEAVES
  carry the real ref. Each leaf is deliberately a leaf: `foldModules` turns a folder holding
  `module.yaml` into an openable row, and this has no such file, so what draws is a name that opens
  nothing, which is the truth about a scanned plugin. Null when the machine has never scanned — an
  empty `@engine` says nothing true.
- **`libraryChains()`** — every library's chains, walked by `@studio/song`'s `libraryChainDirs`,
  the one walk `processChain` and the account's own listings use too: a chain is a folder holding a
  `graph.yaml`, at any depth under a library's `chains/`, and nothing inside one is another. `ref` is
  what the chain is CALLED, whole (`@st0/process/normalize`), `path` where it is in this API
  (`_libraries/st0/chains/…`), because that is the only address a browser may hand back. No
  library, or one with no `chains/`, is an empty list, never a throw.
- **`playlists()`** — `_playlists/**/*.yaml`, rooted at the workspace ROOT and not beside the
  project where the two module libraries live. A set list belongs to the repository rather than to
  one song in it — you build one once and open it against whichever project you are working in — and
  rooting it at the project would give a workspace of four songs four separate playlist folders.
  `title` and `count` come from parsing each file, which is the whole of what a row needs; a file
  that does not parse is listed anyway with `ok: false`, because it is on the disk and a listing
  that hid it would leave you unable to click the thing you have to go and repair.
- **`moduleBases()`** reads the LOADED refs rather than listing `base/` here, because the ancestry
  is the whole value of the answer: the bases are snapshotted onto the shared module that names the
  plugin, and a song points at it through a thin local module whose own folder holds none. Listing
  that folder would offer nothing on exactly the module built to be chosen from — the mistake
  `moduleAssetChoices` exists to have stopped making for assets.
- **`baseSnapshotPath()`** puts a base at `base/<name>.vstpreset` beside the module file. A base is
  an opaque blob kept with the module, for the plugins whose sound is not in their automatable
  parameters — an Arturia patch is not, so `presets.yaml` (numbers only) cannot hold one. `base/` is
  its own folder because the loader already reads `<name>.vstpreset` in the module folder as its
  single default, and a second spelling in the same directory would be two rules over one namespace.
  The path is resolved here and not by the caller, twice over: the builder is forbidden from
  constructing a path at all, and a name arriving from a browser is not a path component until
  something has said so. Both spellings come back because neither is derivable by its consumer — the
  ENGINE writes the absolute one (it is a different process), the browser is told the relative one
  (it has no idea where the workspace lives).

## The bench is not a repository

`POST /workspaces/bench` makes the bench — one live rig — and answers a workspace + project.

Its own route rather than a clone, because there is no repository: the folder is generated, and
deleted and generated again every time it is opened, so putting it under version control would
version something with a lifetime of one session. `ProjectGate` calls this instead of the
by-name → by-repo → clone sequence when the address names `@banc`. `isBenchProject` is the one
place either end spells which address the bench answers; anything else under `@banc` names nothing
and is a 404 saying where a chain and a module are edited instead.

The account's library repository is required and comes from the browser, the side that holds the
session pl8 answers to. The bench's workspace mounts it like any other, and every module the rig
can name is in it; without one there is nothing to try. A library that will not mount is the USER's
problem to read, so it is a 409 and not a fault.

### The bench keeps nothing, and writes nothing back

The rig is scaffolded fresh on every open, so a write into the project folder survives exactly as
long as the session: no translation, no promotion, no path out of it. What a bench session keeps is
what was written into a LIBRARY — `_libraries/<name>/…`, which is an ordinary path here as it is
in every other workspace (`apps/pl8/docs/banc.md`).

That workspace holds the rig and nothing else: a `chains/` folder in it is swept on open, because a
project folder that saves nowhere is worse than no folder at all.

### `_libraries/<name>/…` is a VIRTUAL folder

No workspace holds the libraries: the file service clones them under `<studioHome>/libraries`
(`libraries.md`). `safePath` maps a path whose first segment is `_libraries` there, and confines it
THERE by the same two gates the workspace has — lexical, then on the real path — so
`_libraries/../..` escapes nothing, and neither does a symlink a library carries. `toRel` maps back,
so every path this API hands out for a library file is a `_libraries/<name>/…` one. A library's own
folder, and `_libraries` itself, cannot be renamed, moved or deleted from a workspace: which
libraries the account has is its settings' business.

A library write is a plain write into the account's clone, and nothing is pushed anywhere by the
write itself. What publishes it is the builder's Save (`POST /libraries/publish`), which is
somebody's decision rather than a side effect of typing. `_modules` is untouched by all of that and still forks: it is the WORKSPACE's own library,
one copy backing every project beside it, and nothing has given it a way back. The one exception
either way is a module's `ui.yaml` — a panel is drawn for the plugin, not for the song, so it is
written where the module is, and forking a whole module to move a knob is precisely the copy nobody
wanted.

## Windows handle discipline

Deleting a project moves its whole folder to the recycle bin, and on Windows a directory
can't be renamed while any handle inside it is open: a file watcher's
`ReadDirectoryChangesW` (closed async, just before), or the engine still holding a clip's
`.wav` after an async flush. Both release within a few ms, so `renameWithRetry`'s bounded
retry turns the EPERM/EBUSY into success rather than a failed delete.

Every mutating path therefore releases what IT holds first (`cancelPrewarm()`, and via
`beforeMove` the engine and the watcher), then leans on the retry for anything that
lingers. A non-transient error, or exhausting the retries, still throws. POSIX renames
succeed on the first try, so all of this is a no-op there.
