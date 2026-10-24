# The `picture …` verbs

`src/verbs/picture.ts` — a song's video placements, as commands.

## Why they exist

`apps/k7/frontend/docs/picture.md` had a section called **"Not a command, and why"**, and it was
an accurate description of a gap rather than an argument for one. Every audio edit in the shell is
a verb; a picture placement was dragged, and `App.applyVideoEdit` wrote the lane directly. The page
listed what that cost:

- **no context menu on a picture lane** — the menu is derived from the command catalogue, and there
  was nothing in it to derive;
- **nothing in the palette**, so no way to make a cut by typing, and no way to say one out loud;
- **no CLI**, so a script could not place a shot;
- **no undo entry**, since the journal records commands.

Seven verbs close it. Five are not a new model of picture editing — they are the three drags the
page already documents, plus create and delete. The sixth makes the LANE and the seventh places it
in the frame; before them, both took a text editor.

| verb | writes | the gesture it mirrors |
|---|---|---|
| `picture move <lane> <at> <to>` | `start` | the body drag |
| `picture length <lane> <at> <seconds>` | `length` | the right-edge drag |
| `picture head <lane> <at> <to>` | `start`, `from` **and** `length` | the left-edge drag |
| `picture delete <lane> <at>` | — | (none — the drag has no delete) |
| `picture add <lane> <ref> <at> …` | a new entry | dropping a video file on a picture lane (`apps/k7/frontend/docs/timeline.md`) |
| `picture lane new [name]` | a new LANE, and `trackOrder` | the timeline's `＋ piste` menu |
| `picture rect <lane> <x> <y> <w> <h>` | `frame([x, y, w, h])` | selecting a layer in the VIEWPORT and dragging it |
| `picture split <lane> <at> <where>` | a second placement of the same clip, right after the first | the cut tool on a shot, and `Ctrl+B` at the playhead |
| `picture sound <lane> [track]` | each clip's `sound:` — and, in a chain project only, a lane saying `video_source:` | run by the timeline after a video drop |
| `picture speed <lane> <at> <factor>` | `speed` — dropped again at 1 | (none — a retime has no gesture yet) |
| `picture prepare <lane>` | each clip's `optimized:` / `proxy:`, once its copy is written | run by the timeline after a video drop, beside `picture sound` |
| `picture interchange <otio\|edl> [lane]` | `exports/cut.<ext>` — the cut, for another editor | `project export timeline`, which downloads it |
| `picture import <file> [prefix]` | a new picture lane per video track, and a clip per new medium | (none — the file is put in the project first) |
| `picture render [webm\|mp4] [wav\|none] [settings]` | `exports/<project>.<ext>`, rendered on the server in the background (`packages/file-service/docs/serverRender.md`) | `project export video`, which renders in the browser |
| `picture key` / `picture unkey <lane> <at> <prop> <when> …` | one key of `animate:` | (none — keys are set at the playhead) |

`picture split` is VIRTUAL, as an audio `event split` is: two placements of one clip, the head
ending at the cut and the tail starting there with `from` moved on by the head's length,
so the frames played do not change (`packages/song/docs/materialCut.md` says why a sequence is the
other way). The tail is inserted RIGHT AFTER the head and not appended, because file order
decides which shot covers which (`packages/song-video/docs/transitions.md`), and an appended tail
would cover every shot placed between the two. The head keeps the `fadeIn` and the tail takes
the `fadeOut`, so a shot still arrives and leaves the way it did, with a plain cut between the
halves.

`picture sound` is the one that is not a gesture's twin: it makes the shots audible through the
engine, extracting what is missing, so running it twice changes nothing
(`packages/song/docs/videoSound.md`). In a node project it makes no lane, the picture lane's own
`#audio` half playing the sound; in a chain project, which spells no port, it makes the
`video_source:` lane once, or reuses the one already there. It lives in `src/verbs/pictureSound.ts`,
beside the verbs it borrows `laneFile` from.

## A shot is addressed by WHERE IT STARTS

Not by its `ref`, and this is the one decision worth reading.

The drag identifies a placement by `ref`, because that is what the strip under the pointer carries.
The page records the limit that follows: *"a source placed twice on the same lane has one ref for
two placements, and a drag on either writes the first."*

A verb has no pointer, so it uses the position — and the limit goes with it. `picture move main 5 9`
moves the shot starting at 5s, whether or not another placement on that lane names the same clip.
`setVideoPlacementFieldAt` is the by-index writer added beside the by-ref one for exactly this;
both stay, because the drag still wants the ref it grabbed.

**Two shots starting at the same instant on one lane are refused**, naming the count. The format
allows the pair and no rule picks between them, so guessing would be inventing one. Moving either
one by hand separates them, and then both are addressable.

## The dialect is the lane file's own

Seconds (`12.5`) or `m:ss` (`1:30.5`) — `parseWallClock` from `@studio/song-video`, the same
parser `markers:` uses on the picture side. A `bar:beat:tick` is refused **by name** rather than
mis-parsed.

That is not a limitation, it is the file: a picture lane is in decimal seconds, and there is
one `tempo:` and no tempo map. Accepting a musical spelling would mean two dialects for one number,
with a conversion in between that the file never performs.

## `picture head` is the only one with an invariant

The other four write one field. The head trim writes three, and each is load-bearing — the page
states it, and the verb now enforces it:

- **`from` moves by the same delta as the head**, or the frame under the new edge is not the
  frame that was there;
- **`length` moves by that delta the other way**, or the tail slides and the trim is a move wearing
  a trim's clothes.

Two refusals guard it, because a command can be typed where a drag could only be dropped:

- a head that would walk back **past the source's own first frame** — `from` cannot go
  negative;
- a trim that would leave the shot **zero or less** long, which says "trim the tail instead".

A `length: 0` shot keeps its length untouched. Zero means "to the end of the source", a duration
only the compiler can measure, so pinning a number here would invent one.

## `picture rect` is the only verb here about SPACE

Every other one is about time — where a shot starts, how long it runs, which lane draws first. This
one says where in the frame a lane draws, in viewport px, and it is what the viewport's selection
box writes on release (`apps/k7/frontend/docs/picture.md`).

It writes **all four** numbers of `frame`, always. A lane stating three of them and inheriting the fourth is a
rect nobody can read, and the fourth would come from the viewport default that exists precisely so
a lane can state NO rect and fill the frame. Either say the whole rect or say none of it.

A zero side is refused by name rather than written: a lane `0` wide draws nothing while looking
exactly like a lane, which is the failure this format has already paid for once.

## `picture lane order` counts layers bottom-first, and writes `trackOrder`

Position 1 draws FIRST, which puts the lane at the BACK: the verb counts layers, as a compositor
does. What it writes is the rows' order, `trackOrder`, where the TOP picture row draws in front, so
it refills the picture rows' own slots in the reverse of its count; the sound rows between them do
not move.

The timeline's drag never sends a number: it names the lane whose place is being taken, and this
verb does the counting.

## `picture lane new` writes the lane, and states `trackOrder`

Every other verb here rewrites one lane. This one writes the lane file — `nodes/<id>.k7x`, or
`tracks/<id>.k7x` in a chain project, extending `@meta/picture-track` — **and** states
`trackOrder` with the new lane above the picture lanes there are, so it draws in front, where you
can see what you just made (`createPictureLaneFile`, `packages/song/src/projectFiles.ts`). The
other rows keep the order they drew in. A song with no `project.k7x` gets the lane alone: the file
is what makes a lane exist, the order only places it. Named nothing, it picks `layer-N` off the
lane folder.

It refuses a name a lane, a track or a module already has: the graph draws a song's lanes and its
picture lanes in one name space.

## `picture lane rename` and `delete` follow the name into six places

A picture lane is named by its file, `trackOrder`, `soloed:`, the graph (`graph.k7x`, or its
item in `chains/`), the `video_source` of a chain project's lane sounding it, and every timeline lane of its name,
which draws on it. A rename that missed one would leave that one naming nothing, which the compile
refuses or, worse, draws as nothing. So `rename` rewrites all six, and a timeline lane keeps the old
name only where the new one is taken in its timeline, saying so.

`delete` is a track's: it asks first (`confirm:`), takes the lane out of the graph rejoining around
it, and leaves its clips on disk. It refuses while a lane plays its sound, since that lane would
then be refused by the compile; it does not delete the sounding lane for you, that being a
track with a fader and a chain. A timeline lane drawing on a deleted one is left, and named in the
log: it is the timeline's content, and `picture lane new` brings a lane for it back. Both refuse a
lane a surface maps, as `track rename` and `track delete` do. On `<timeline>><lane>` they act on
that timeline's file alone.

## `picture add` reports rather than refuses

The `ref` names a `clips/` entry, and only the compiler reads those. A ref with no file is
**placed, and said out loud** — `no clips/<ref>.k7x — the lane will report it until there is one`.
Refusing would mean this verb could not run before the clip exists, and the order people work in is
not something a verb gets to choose. The lane already reports an unresolved ref on the surface
itself.

A lane whose `events:` is in a shape the text edit cannot extend is refused with the same sentence
`playlist song add` uses, and for the same reason.

## What they do not do

- **No cross-lane move.** `event move` takes an optional destination track; this does not. Moving a
  shot between lanes is a delete and an add, and the two lanes may have different geometry —
  nothing here would know what to do about that.
- **No split.** For picture it is two placements sharing a source with a computed `from`,
  which is a real feature and not a variation on these five — `picture split`, above.
- **They do not create lanes.** A shot verb names a picture lane that exists, and refuses one
  that does not: placing a shot is not how a lane is made.
