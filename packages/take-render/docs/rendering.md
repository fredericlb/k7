# What this package writes, and why each file says what it says

`take-render` is the audio a song PRODUCES: filing a take, rendering a mixdown, cutting material
in two, reading a wav's length. This page holds the reasoning behind those functions.

## A freeze render is a MIXDOWN of a closure

`freezeUpstreamRender` bounces everything a freeze covers — the upstream closure of one module,
at that module's output — and it is a mixdown of the closure rather than a per-track bounce. A
freeze point may be a bus several lanes meet at, so the
document is cut down to exactly the plan (those lanes, those plugins, the sends between them) and
rendered whole. What comes out is precisely what that part of the song was contributing, which is
what the render has to stand in for.

Two things follow from the cut:

- `solo` is cleared. Nothing outside the plan is in the document, so a solo could only silence
  the render.
- A send LEAVING the plan is dropped — its bus is not in this document — while one INSIDE it is
  how the lanes reach the point they are being frozen at.

Nothing else is neutralised. Gain and pan are a `Mixer` MODULE: upstream of the point it belongs
in the render, downstream it is not in the document at all. The one thing there would otherwise be
to flatten by hand is the one thing the plan already answers. See
`packages/song/docs/freeze.md`.

A plugin id is `<chain>:<module>` and a module name may itself hold a colon (`synth:lead`), so
`pluginModule` splits on the FIRST one.

## `radiok7` is read as well as `k7`

The credentials file is the USER's, at their workspace root, so `readK7File` accepts both
spellings — `k7` / `k7Url` / `k7Token` and `radiok7` / `radiok7Url` / `radiok7Token` — and `k7`
wins where both are written. A key nobody reads fails by silently having no credentials, which
reads as "sharing is broken" rather than "rename your key".

## A recorded take's clip file states its window in full

`writeClipDecl` writes `from` and `to` even though `"1:1"` to the take's end is exactly what an
absent window already means. Because that is the file you open to trim the take, and the two
numbers you came to change should be sitting there at their real values rather than having to be
conjured from a blank file. It also pins the extent at the length the ENGINE reported: the wav on
disk is the only other record of it, and a take does not want its end to be a property of how a
decoder rounds.

The FILENAME is the id, so there is no wrapper naming it a second time.

Positions here are all POSITIONS, 1-based: where the take lands on the timeline, and where its
window opens and closes IN THE FILE. `to` is the take's length read as a position from the file's
start, which is what `"1:1"` for `from` makes it — not a duration.

The engine writes a temporary name and the brain owns the final one,
`{trackId}_{bar.beat}_{stamp}`. Colons never leave `addTakeToTrack` (they are not
filesystem-safe), and the clip id IS the basename, so the rename covers both.

Recording over something silences what it covers, and the engine owns that silence: once the
punch-in arrives — after the count-in, so the old material stays audible while it clicks — it
mutes the armed track, so the already-recorded clips go silent under the pass. The mute is
session state — it dies with the roll and never reaches a file — so this writer only places the
new clip and does no overlap arithmetic; a stop restores the track's mute and the old material
returns beside the take.

A take recorded in the TAKES view goes elsewhere: `addTakeToEvent` declares it the same way, then
adds it to the event it was armed on and comps it in over what was played, instead of placing it on
the lane (`packages/song/docs/takes.md`). Nothing is muted for it — the lane was sent with the punch
already cut out.

The clip is declared BEFORE it is placed: a placement naming no clip fails the compile, so the
order keeps the project loadable at every instant. `addTakeToTrack` throws when the take's file is
not where it says, for the same reason — a clip whose wav is missing makes the whole project fail
to compile, and refusing the edit beats writing a song that no longer loads.

`fileStamp` is the wall-clock spelling every dated file in a project uses, `260814T194357`. It is
exported because a bounce needs the same one: two runs of one chain over one clip must not land
on one name, for the same reason two takes of one bar must not. The date is an ARGUMENT so a
caller can be tested; nothing but a test ever passes one.

## A rendered clip's definition states a `source:` and NOTHING else

`renderedClipYaml` is the text half of `fileRender`, and the nothing is the decision.

`from`/`to` are a WINDOW into a file. What was rendered is the whole of the new material, so
there is no window: carrying the numbers over from the thing this was cut out of would frame the
render with somebody else's, and writing a `to` equal to the file's own end would not be a window
at all — it would be the file's DURATION, copied into the song. That copy goes stale the moment
`clip process` repoints `source:` at a processed wav of a different length, and nothing would
notice: the clip would draw and play to a second that no longer exists in it.

The reason to want one is real: an absent extent gives the browser no length, and nothing there
can measure a file — a three-bar render would draw as a single bar. That is answered where it
belongs, on the side that HAS the audio: the file service measures the source and fills the length
in on its way to the browser (`naturalBeats` in `workspace.ts`). One source of truth, and it is
the file.

The `seconds` a render reports is the wav that came OUT, not the span that went in: a tail
ringing past the cut is in the file and is what plays, so reporting the request would understate
what was written.

A clip name is stamped rather than numbered, like a take. Two consolidations of one range a
minute apart are two different renders, and a name that collided would have the second silently
overwrite the first's audio while both definitions still pointed at it.

## Splitting and consolidating

A physical split is TWO renders rather than one and a trim, because what has to come out is two
whole files: the halves are then ordinary material that can be processed, warped or moved apart,
which is the reason to want a physical split rather than the virtual one. The material it cut is
left on disk, exactly as the sequence half leaves it (`packages/song/docs/materialCut.md`).

A consolidation renders everything in the rectangle into one file. Every clip is laid on one
track at its offset from the rectangle's start and the whole thing is bounced, so **gaps come out
as real silence**: nothing plays there, and the render is that long anyway because the document
is. That is what makes the result play back identically. Each clip is only re-based on the
rectangle — its window, its fades and its warp ride along untouched, because what is being
rendered is what plays.

## Reading a wav's length

`wavSeconds` answers null rather than throwing, and null rather than 0: every caller has
something better to do than fail — the bounce that asks writes the render either way, and a
length it could not establish means "leave the map alone", which is the safe half of that
decision.

The `data` size is taken as the FILE says it, clamped to what is actually there. A render killed
mid-write leaves a header claiming more than the disk holds, and believing it would stretch a
clip's map onto seconds that do not exist. The clamp reads the size through the SAME descriptor
the bytes came from, so a file replaced between the open and the stat cannot give a size from one
and bytes from the other.

## `timeline.ts` is a script, not an export

`describeTimeline` prints a project's arrangement — the read-only counterpart to the web Timeline
tab, and the sibling of `@studio/song`'s `graph.ts`, which shows ROUTING rather than what is
ARRANGED. Neither is a command: what they print is what the panes draw, so a palette row would be
a verb nobody runs. `describeTimeline` stays pure — a doc in, strings out — which is what lets the
two surfaces share it.

It is deliberately NOT published in `exports`, because a script is reached by path and never by
specifier: the subpath would be one nothing can import. Run it with `npx tsx`, and its
positionals mirror `graph.ts`'s.

The output clusters like the web timeline so both surfaces describe one project alike, and a
dangling `group` shows as ungrouped — print what the song has.
