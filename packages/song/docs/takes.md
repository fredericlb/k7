# Takes

A **take** is what a lane was playing, set aside. Record over an event, or record round a loop,
and the events that were on the lane move into a take rather than being overwritten or stacked
under the new pass.

```yaml
# nodes/gtr.yaml
extends: "@studio/audio-track"
events:
  - { ref: gtr_3.1_260815T221030, start: "3:1:1" }
takes:
  - events:
      - { ref: gtr_3.1_260815T220641, start: "3:1:1" }
```

It is the same shape as `events:` because it *is* the same thing: a list of placements. That is
the whole design, and everything below follows from it.

## Why a list of placements, and not a new kind of object

A take has to draw like the arrangement it was — same clips, same extents, same names — because
the reason to keep one is to compare it with what replaced it. Any second shape would have to be
compiled by a second reader, and the two would drift on the first field either one gained.

So `takes:` compiles through the **same** `placementToClip` the lane's own `events:` go through
(`nodeProject.ts`), reaches the browser through the **same** `toWebClip` (`workspace.ts`), and
draws as a row of the same geometry. A take is not a special case anywhere except in what it is
allowed to do: nothing. It has no level, no arm, no chain, and no drag.

## The engine never sees one

A take is not playing, so it has no business in the document the engine diffs.

It is nevertheless compiled onto `TrackDoc.takes`, and stripped at the one point a document is
sent — `withoutTakes` in `engineClient.sendProject`, beside `withGroupMix`. Compiling it and then
dropping it may read as waste; the alternative is a second compile of the same folder to answer
the same question, which is how the two would come to disagree about a take's length.

`withoutTakes` returns the document **unchanged** when no lane has a take, so a project without
them costs nothing at all.

## The swap is what makes a take free

`track take select <track> <n>` does not *load* take `n`. It **exchanges** it with what the lane
is playing: the arrangement becomes take `n`, and take `n` becomes the arrangement.

That is what makes listening to another pass a reversible act — nothing is lost, no take is
consumed, and running the same command again puts everything back. A "load" verb would have had
to decide what happens to the arrangement it displaced, and every answer to that is a way to lose
a take by accident.

The numbering is stable through it, because a swap moves contents and not entries: take 2 is
still take 2 after you have listened to it.

That is also what makes the review panel's sidebar work. It lists every take plus what the lane
plays, and **clicking one is a select** — so the take you are looking at is the take you would
hear, in the song, with the rest of the band. Nothing there is a preview mode; there is only what
the lane plays, and a cheap way to change it. See `apps/l8/frontend/docs/shell.md`.

## Choosing one: `track take keep`

`track take keep <track>` keeps what the lane is playing and deletes every take.

It names no take, and that is the point: you have listened round them, each listen leaving the one
you liked on the lane, so the choice is already made by the time you reach for this. A verb that
took a number would be asking the question a second time, and would let the answer differ from
what you are hearing.

It is one act rather than a loop of `track take delete` at the call site: half of "keep this one"
applied is a state nobody asked for.

## Whose takes they are

`takes:` is an ordinary field of a module, listed in `MODULE_FIELDS` — so an **alternative** can
carry its own, exactly as it carries its own `events:`.

That is not incidental. Two alternatives are two ways of playing the part, and a pass recorded
against one is not a pass of the other. The writers in `yaml/trackFile.ts` follow the same rule
every other placement edit follows (`clipsToEdit`): the edit lands on the **selected** set, so
recording over a lane running `loud` sets `loud`'s events aside and leaves the module's own list
untouched.

## What recording decides, and how

`addTakeToTrack` makes a take when the finished pass **overlaps** something the lane is playing.
The overlap is read off the compiled document, so what counts is what the lane actually sounds —
windows and loops folded in — rather than what its file happens to say.

Two consequences worth knowing:

- **Merely touching is not overlapping.** A take that starts exactly where the last event ended
  follows it; it does not record over it.
- **A loop makes one take per pass**, with no loop-specific code. Pass 2 finds pass 1's clip
  under it and sets it aside; pass 3 finds pass 2's. The caller recompiles between takes
  (`engineLink.ts` invalidates the cached doc), which is what keeps that true.

An empty lane makes no take: recording onto nothing is not recording over anything, and an empty
take is a row that says nothing.

## The files stay hand-written

All three writers (`pushClipsToTake`, `selectTake`, `removeTake`) **move YAML nodes** rather than
rebuilding values. A placement carries its own comments and its own spelling, and it should read
the same after being set aside as it did before — a take is meant to be a record of what you
played, and a record that has been reformatted is a weaker one.

`removeTake` deletes the `takes:` key with the last take, rather than leaving `takes: []`.
Absent is how a lane with no takes reads.

## Where each piece lives

| what | where |
|---|---|
| the field | `yaml/moduleSchema.ts` (`MODULE_FIELDS`) |
| the three writers | `yaml/trackFile.ts` |
| the lane-level wrappers | `trackMix.ts` |
| the compile | `nodeProject.ts` → `TakeDoc` (`@studio/engine-protocol/project`) |
| the strip | `project.ts`'s `withoutTakes`, applied in `engine-client` |
| the wire to the browser | `WebTake` in `@studio/web-protocol`, filled by `workspace.ts` |
| the rows | `apps/l8/frontend/src/rows.ts`, drawn by `TimelineTab.tsx` and `Minimap.tsx` |
| making one while recording | `packages/commands/src/recordTake.ts` |
| the review sidebar | `apps/l8/frontend/src/takeReview.ts` → `AudioClipPanel.tsx` |
| the three verbs | `commands.yaml` → `track.take.select` / `track.take.keep` / `track.take.delete` |
