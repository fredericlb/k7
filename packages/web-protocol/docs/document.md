# The compiled project, on the wire

`timelineTypes.ts` carries the flat document a surface draws from: `WebProject` and its tracks, clips
and notes, plus `WebVideoProject` for the picture. The backend compiles the node project into
it, so the timeline needs to know nothing about chains or modules. This page holds the *why*
behind the fields that look redundant, so the type file can stay a list of names.

## Why a clip carries its window as well as its placement

`WebClip.offset`, `sourceFrom` and `sourceTo` are the three numbers `regionWaveform` reads, in
the units `ClipDoc` states them in: `offset` is the placement's in-point, `sourceFrom`/`sourceTo`
the clip file's own window in seconds (absent meaning the file's start, or its end).

They are on the wire because the browser **caches** a clip's envelope. Without them, a trim moves
the window while the picture stays: same id, so the cached envelope is reused and the block goes
on showing material the clip does not play. `apps/k7/frontend/src/clipEnvelope.ts` is the only
thing that reads them.

All three are optional, including `offset` — which is required on `ClipDoc` and cannot be here.
The shell **synthesises** stand-in clips to open an editor over, and those know an id and a name
and nothing about a placement. A required `0` would have them claim an in-point they never had.

`sourceName` is the audio file's NAME and never its path: enough to tell that a bounce repointed
the clip at a new file, which is the other way its material changes without the placement moving.
The path stays server-side — nothing in the browser may resolve one.

## Why `event` sits beside the resolved numbers

`WebClip.event` is what the PLACEMENT itself said, unmerged: the same `EventDoc` the compiler
builds, passed through untouched, absent when the event stated nothing beyond its `ref` and
`start`.

Everything else on the clip is the placement and its material already resolved *together*, and
that is one-way. `sourceFrom`/`sourceTo` are the intersection of two windows, a sequence's window
is over in `loopStart`/`loopEnd`, and the repeat count is multiplied into `length`. So a surface
can DRAW an event from the rest of the object and cannot WRITE one back — without `event` a
copy/paste on the timeline drops the trim, the fades and the passes.

`apps/k7/frontend/src/clipboard.ts` reads it, and nothing else does. It is deliberately *beside*
the resolved numbers rather than instead of them: those stay the drawing's single source.

## The fades

`fadeIn`/`fadeOut` are in BEATS, absent meaning no fade — which is also how the file says it, the
field being deleted rather than written as zero.

They are on the placement, on the engine wire and in the C++ engine as well, and this document is
what lets a BROWSER see them: without them the timeline can neither draw a fade nor let one be
dragged, and the only way to set one is to type it in the file. Beats rather than the file's timecode, like
every other time on this document — a surface measures in the unit it draws in.

## `frozen`, and why editing has to know

`WebClip.frozen` says this clip is a RENDER, not a placement: the lane is frozen and this stands
in for it. That matters to anything that would edit it. There is no `clips:` entry for a move to
rewrite, and a bar-1 render sitting over a real placement at bar 1 means a drag would move
material the lane is not even showing. See `packages/song/docs/freeze.md`.

`warpOff` is the same kind of distinction one level down: `warped` alone cannot tell "never
stretched" from "stretched, switched off here", so both are sent and the timeline draws the second
as the icon with a line through it. `disabled` is the event-level mute — still drawn, dimmed,
because an event you cannot see is a deleted one; the ENGINE is what skips it.

## `WebWaveform`: drawing space vs commanding space

Everything on `WebWaveform` is in **region seconds**, which is the right space to draw in and the
wrong one to command in — `clip warp` names a moment of the SOURCE file. Three fields exist to
close that gap.

- **`sourceMap`** is the linear file↔display mapping every second above went through:
  `display = (file − inPoint) × stretch`, so `file = display / stretch + inPoint`. Without it a
  surface would have to rebuild the pair out of `offset`, `sourceFrom` and the warp ratio, which
  is a second copy of the one thing the producer already computed.
- **`WebWarpMark.src`** is the FILE second a point pins — what `clip warp` and `clip warp remove`
  name it by. On the wire because the mapping is PIECEWISE (the engine pins every interior marker
  as its own beat point), so a surface cannot invert it from two numbers.
- **`sourceWindow`** is the material's own `from`/`to`, in the same region seconds. Sent only when
  the picture is WIDER than the window, which is the `whole` view: a placed clip is drawn from its
  in-point, so there the region and the window are the same thing and a band over the whole pane
  would say nothing. Absent therefore means "nothing to shade", not "untrimmed". Named for the
  SOURCE rather than plainly `window`, because it is passed straight to a React prop and a prop
  called `window` shadows the global one inside the component that draws it.

`transients` are the display seconds where the onsets ARE, with the clip's corrections already
applied — every surface reads that one and therefore agrees. `detected` and `onsetEdits` are the
list before corrections and the corrections themselves, in FILE seconds as the clip stores them;
only an onset editor needs them, to tell a detected onset from a hand-placed one and to name a
removal by the time the DETECTOR gave it rather than by wherever the pointer was. See
`packages/song-edit/src/onsets.ts`.

## `ChangedFile`: what a command touched

`POST /command` reports one entry per file a writing command touched. It comes out of the
journal's own diff — the two images `recordChange` compares to build the undo entry — so naming
it costs nothing.

What it is FOR is the reload behind a command: a client that knows a marker moved inside one clip
file can skip the routes that answer about files and names, which cannot have changed. See
`apps/k7/frontend/src/reloadScope.ts`.

Its paths are PROJECT-relative (`clips/x.k7x`) — the vocabulary `Hints.paths` speaks, and the one
an anchored test can trust. The journal's own `files` stay workspace-relative.

## A track's strip, and the fields that are NOT on it

`WebMixer` is one track's strip, read off the mixer module at the end of its chain. `module` is
the node ref an edit addresses (`"mixer:vo.jo"`); the rest are that module's params in their own
units — dB for the level, −1..+1 for the pan.

The three tone bands are not among them. They live on the MIXER — the plugin has them, the module
declares them, a panel can bind them and a node file can hold them — but a track does not carry
them: a strip's EQ is the mixer module's business, reached where every other module param is, and
lifting three of its params onto the track would mean two places to read one value.

`WebTrack.mixer` being absent means the track has NO strip: not "at unity", but nowhere to put a
level, which is a thing to say rather than a dead fader to draw.

Three other groups left `WebTrack` outright and did not come back:

- `docs` / `todos`, for the Docs panel, gone with it — a note is a doc module on the graph now
  (`@meta/doc`); see `packages/song/docs/docModules.md`.
- `frozen`, `alternatives` and `alternative`, for the lane header, gone with the fields they came
  from; see `packages/song/docs/trackModules.md`.

Both are facts about the module a lane *is*, so the timeline's gutter reads them off `WebGraph`
(`trackAlternatives`, `frozen`) rather than off a second copy on this document. Putting them back
would also cost a clone of the module vocabulary on every 2 s poll of `/project-doc`, which is
memoised per revision and this route is not.

## Picture: the same folder, read again

`WebVideoProject` is a separate document and not a section of `WebProject`. Nothing on it is a
beat — a shot is cut against the wall clock — and keeping it apart is what keeps the frame out of
what the C++ engine is handed, without anything having to strip it on the way. One timeline draws
both and its ruler reads either; see `apps/k7/frontend/docs/picture.md` and
`packages/song-video/docs/picture.md`.

`WebVideoPlugin` is one pass over the picture, a video chain's step compiled. A `shader` carries
its GLSL **inline**: the browser cannot open the module's `shaders/` folder, and a page of text is
smaller than the route that would serve it; absent when the node has nothing picked, which draws
as a pass that lets its picture through. `audioFrom` names a LANE rather than carrying a number,
because the number moves — the engine pushes levels at ~20 Hz and the surface holding that stream
is the one that can look one up. See `packages/song-video/docs/shaders.md`.

## The command catalogue

`ArgClass` mirrors `ARG_CLASSES` and `ArgProvider` the `PROVIDERS` keys, both in
`packages/commands/src/commandSpec.ts`, where a test fails if they drift.

`kind` is only the colour an argument is drawn in; `provider` is the PRECISE type of thing it
names — `file` is a clip AND a sequence AND a module asset, and `module` is also a category. Three
providers are worth a word:

- **`nodes`** is one of this project's *uses* of a module, which is what the `node …` verbs
  address. Separate from `modules` because a `@ref` names a shared definition, and those are
  edited in the builder rather than by a verb — see `packages/song/docs/nodes.md`.
- **`playlists`** is a set list of the REPOSITORY, `_playlists/<name>.k7x` with subfolders kept.
  The one provider that reads nothing of the open project.
- **`surfaceTypes`** is a closed set of words rather than something read off the project: the file
  being named is the one the command is about to create.

`CommandInfo.readable` is one sentence per language on what the command DOES — what the palette
lists and matches on. The command name stays the CLI's in every language: a name is an identifier
and a sentence is an explanation.
