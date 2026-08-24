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

Five verbs close it. They are not a new model of picture editing — they are the three drags the
page already documents, plus create and delete.

| verb | writes | the gesture it mirrors |
|---|---|---|
| `picture move <lane> <at> <to>` | `start` | the body drag |
| `picture length <lane> <at> <seconds>` | `length` | the right-edge drag |
| `picture head <lane> <at> <to>` | `start`, `source_from` **and** `length` | the left-edge drag |
| `picture delete <lane> <at>` | — | (none — the drag has no delete) |
| `picture add <lane> <ref> <at> …` | a new entry | (none — a drop from the tree) |

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
