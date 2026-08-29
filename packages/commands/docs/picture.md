# The `picture …` verbs

`src/verbs/picture.ts` — a song's video placements, as commands.

## Why they exist

`apps/st0/frontend/docs/picture.md` had a section called **"Not a command, and why"**, and it was
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
| `picture head <lane> <at> <to>` | `start`, `source_from` **and** `length` | the left-edge drag |
| `picture delete <lane> <at>` | — | (none — the drag has no delete) |
| `picture add <lane> <ref> <at> …` | a new entry | dropping a video file on a picture lane (`apps/st0/frontend/docs/timeline.md`) |
| `picture lane new [name]` | a new LANE, and `project.layers` | the timeline's `＋ piste` menu |
| `picture rect <lane> <x> <y> <w> <h>` | `x`, `y`, `w`, `h` | selecting a layer in the VIEWPORT and dragging it |

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

That is not a limitation, it is the file: `video_tracks/*.yaml` is in decimal seconds, and there is
one `tempo:` and no tempo map. Accepting a musical spelling would mean two dialects for one number,
with a conversion in between that the file never performs.

## `picture head` is the only one with an invariant

The other four write one field. The head trim writes three, and each is load-bearing — the page
states it, and the verb now enforces it:

- **`source_from` moves by the same delta as the head**, or the frame under the new edge is not the
  frame that was there;
- **`length` moves by that delta the other way**, or the tail slides and the trim is a move wearing
  a trim's clothes.

Two refusals guard it, because a command can be typed where a drag could only be dropped:

- a head that would walk back **past the source's own first frame** — `source_from` cannot go
  negative;
- a trim that would leave the shot **zero or less** long, which says "trim the tail instead".

A `length: 0` shot keeps its length untouched. Zero means "to the end of the source", a duration
only the compiler can measure, so pinning a number here would invent one.

## `picture rect` is the only verb here about SPACE

Every other one is about time — where a shot starts, how long it runs, which lane draws first. This
one says where in the frame a lane draws, in viewport px, and it is what the viewport's selection
box writes on release (`apps/st0/frontend/docs/picture.md`).

It writes **all four** keys, always. A lane stating three of them and inheriting the fourth is a
rect nobody can read, and the fourth would come from the viewport default that exists precisely so
a lane can state NO rect and fill the frame. Either say the whole rect or say none of it.

A zero side is refused by name rather than written: a lane `0` wide draws nothing while looking
exactly like a lane, which is the failure this format has already paid for once.

## `picture lane order` counts in `layers`, which is bottom-first

Position 1 draws FIRST, which puts the lane at the BACK. That is the file's own direction and the
verb keeps it rather than inventing a friendlier one — `layers:` is read by the compiler, and a
verb that counted the other way would disagree with the list it writes.

The timeline lists its picture rows the other way round (front layer at the top), so its drag never
sends a number: it names the lane whose place is being taken, and this verb does the counting.
`apps/st0/frontend/docs/picture.md` has the reason that reversal exists.

## `picture lane new` writes TWO files, and looks the second up first

Every other verb here rewrites one lane. This one writes `video_tracks/<id>.yaml` **and** appends
the id to `project.layers` — because `layers` is the membership, not just the order: a lane absent
from it fails the picture compile by name. Two writes, one act.

So `project.yaml` is found *before* either write happens. A song with none is refused with
`no project.yaml — a picture lane has nowhere to be listed`, rather than left holding a lane file
that would have to be listed by hand. Named nothing, it picks `layer-N` off the directory — the
lanes are files, not something the song's own document holds.

It refuses a name a lane, a track or a module already has: the graph draws a song's lanes and its
picture lanes in one name space.

## `picture add` reports rather than refuses

The `ref` names a `clips/` entry, and only the compiler reads those. A ref with no file is
**placed, and said out loud** — `no clips/<ref>.yaml — the lane will report it until there is one`.
Refusing would mean this verb could not run before the clip exists, and the order people work in is
not something a verb gets to choose. The lane already reports an unresolved ref on the surface
itself.

A lane whose `events:` is in a shape the text edit cannot extend is refused with the same sentence
`playlist song add` uses, and for the same reason.

## What they do not do

- **No cross-lane move.** `event move` takes an optional destination track; this does not. Moving a
  shot between lanes is a delete and an add, and the two lanes may have different geometry —
  nothing here would know what to do about that.
- **No split.** `event split` needs a machine for audio; for picture it would be two placements
  sharing a source with a computed `source_from`, which is a real feature and not a variation on
  these five.
- **They do not touch `layers:`.** Which lanes exist and in what order is `project.yaml`'s, and a
  verb that placed a shot on a lane the song does not draw would be writing into a file nobody
  reads.
