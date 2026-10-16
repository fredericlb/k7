# withGroupMix — what the engine is (and isn't) told

One transform applied on the way out to the engine (see `engineClient.sendProject`), and one
concept it is never handed at all.

## `withGroupMix` — fold a concept the engine lacks

A group is a mixer RELATIONSHIP, not a lane: it holds no material, never reaches the
engine, and the engine resolves mute/solo per audio track. So a group's own mute/solo
means nothing until it's pushed down onto the tracks that carry it.

It applies to the live tracks of a group's `algo/` pattern exactly as it does to
authored members: they carry the same `group` pointer, so muting the group silences the
tracks its pattern streams. That is the only way those tracks CAN be muted — they're
synthesized per tick and have no file of their own to carry a flag.

**OR, not override**: a member muted on its own stays muted in an unmuted group. Solo
folds the same way, and the engine's mixer-wide rule does the rest (any solo anywhere
silences every un-soloed track), so soloing a group solos its members against the whole
mixer.

## No picture — a concept the engine has no business having

A video track holds no sound — the file's own audio is dropped by design, and every
sound in a song comes from Tracktion — so the engine has nothing to do with one and is
told nothing about it. That is a property of the document rather than a transform: a
`ProjectDoc` has no picture field, and the picture compiles to its own `VideoProjectDoc`
(`packages/song-video/docs/picture.md`).
