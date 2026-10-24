# Timelines — an arrangement placed whole as one event

`timelines/<id>.k7x` is a material, like `clips/` and `sequences/`: lanes of events, placed on a song
lane by `ref` as one event. The schema is `@studio/song-schema`'s `yaml/timelineSchema.ts`, the
compile `src/compile/timelines.ts`, the user's page `apps/k7/docs/22-syntax-material.md`.

## Its sound goes through the lane it is placed on

A timeline's lanes are not the project's lanes. A project lane is a node of the graph — a module
with a chain, a fader and sends — and a timeline placed twice on two lanes would otherwise need two
copies of every one of those, or a sub-mix the engine has no notion of. So a timeline's lanes carry
events and nothing that sounds: what they hold plays through the host lane, its instrument and its
effects, exactly as if it had been placed there event by event. A lane inside a timeline keeps
material apart while it is written; `disabled` silences it wherever the timeline is placed.

The engine never hears of a timeline. Every event inside one compiles to an ordinary clip on the
host lane, so nothing in `engine/k7-runtime` changed for it, and overlapping clips on one engine
track already sum.

## Expanded before routing, because a lane has two halves

A lane wired by `#audio` and `#midi` compiles to two engine tracks, and each event goes to the
half its material plays on (`graphModel.md`). A timeline holds both kinds, so it is expanded into
its events first and each of those is routed on its own. The alternative — routing the timeline as
one event — has no half to pick.

## Its length is fixed

`length` is a duration; left out, it is the content's end rounded up to the bar. An audio clip with
no `to` counts as nothing past its start there, since only the engine can measure a file: a
timeline holding one should state its length. Every placement plays exactly that span and cuts
what runs past it — a clip with no stated length is given the room left, which the engine clamps to
the file.

So a timeline event takes no `from`, `to`, `loop`, fades, `warp`, takes, comp or crossfades
(`FIXED_FIELDS` in `@studio/song-schema`'s `timelineLane.ts`): each would give the event an extent
of its own, which is precisely what a fixed length rules out. The compile refuses them by name, and
the verbs refuse before writing them. `gain` and `disabled` are the two words it keeps, applied to
every clip it plays — the gain to audio only, as on any event (`song-edit` `docs/eventGain.md`).

A timeline inside itself, directly or through another, has no length and no end: it is refused
when the project is read and before a verb writes it.

## One event to the surfaces

Each clip a timeline plays carries `nest` — the OUTERMOST timeline event it belongs to, the one
on the song lane — and an id prefixed by every timeline event it sits in, `verse@8>fill@4>kick@0`.
`>` is the separator because no file name holds it, so `materialRefOf` reads the material after the
last one and a nested id never collides with a placement of the same material on the lane itself.

The browser's projection folds those clips back into one `WebClip` with `timeline` (the file
service's `webNest.ts`, beside the comp fold): the timeline view moves, copies, mutes and removes
the EVENT, by its own start, and draws what it holds inside it. The verbs find a timeline event by
`nest.start` and never by an expanded clip's start, which would name an event the lane file does not
hold.

## A timeline's own view, and its lanes' address

`ProjectDoc.timelines` carries every timeline compiled at its own positions, for the view that
edits it; the engine ignores it as it ignores `groups`. A timeline's lane is addressed
`<timeline>><lane>` wherever a verb takes a lane, and `laneEventsAt` (`chainItemEdit.ts`) resolves
that address to the timeline file and the lane's map inside it. Every event writer goes through it,
so add, move, paste, resize, split and loop work inside a timeline with no verb of their own.

A lane moves between timelines as its events alone (`timeline lane copy`, `verbs/timelineLaneCopy.ts`):
they are references, so a copy shares its material, and a timeline's lane has no chain to copy. Into
the song it becomes a lane with a fresh strip, since a song lane is a module node and needs one.

## Its picture draws on the song's lane of the same NAME

A timeline holds picture lanes too, under `pictures:` — shots in SECONDS from its start, the shape of a
picture lane's `events:` (`TimelinePictureSchema`, its shots in `PlacementSchema`). They are a list of their own rather than a
kind of lane because the two count time differently: one lane name per timeline still, across both.

Where a placed timeline's shots draw cannot be the lane it is placed on, as its sound does: that is a
sound lane, with no frame, no layer and no video run. So a picture lane lands on the song's picture lane
of its NAME, in that lane's frame and through its effects. A copy keeps the name, so a lane copied from
the song into a timeline draws where it came from. A timeline lane with no song lane of its name draws
nothing and the picture compile says so; inventing a layer for it would put on screen a lane with no file,
whose mute, solo and frame no verb could reach.

`timelinePictures.ts` expands them as `expandEvents` does the sound: every timeline event on a song lane,
nested ones included, shifts its shots by where it plays and cuts them at its end. Each placed shot gets
an explicit length — the picture's rule (a length, else the next shot's start, else open) applied within
its own lane — since on the song lane its "next shot" would be somebody else's. They are put FIRST on
that lane: a lane's own last shot with no length is open-ended, and a placed shot after it in file order
would end it. So the lane's own shots cover a timeline's where both are on.

Both compiles read the merged lane: the picture draws it, and a lane sounding that picture lane
(`videoSound.md`) plays the placed shots' sound too, heard where they are seen. The picture document
also carries each timeline's own lanes at its own positions (`VideoProjectDoc.timelines`), the view
that edits them. A placed shot carries `timeline`, the one whose file holds it: the verbs and the drag
address a lane's file by index, and must never be handed it.

## Auditioned alone, through its host

A timeline has to be heard while it is written, and its lanes have no instrument of their own. So
auditioning it (`timeline play <id>`, sent by the timeline pane when it opens one) sends the engine
that timeline alone from beat 0, on the lane it is FIRST placed on — both halves of it — with every
other song lane emptied and muted and the busses and master untouched, since the host's sends are
part of how it sounds (`src/timelineAudition.ts`). A timeline placed nowhere gets a bare track:
its audio is heard, its notes have no instrument.

The choice is per session and in memory, applied as the document is sent, like an armed take — the
file service's `timelinePlay.ts`. It is never written: what a pane has open is not part of the song,
and the browser's own document stays the song's.
