# What the media library can complete

Two library screens show YAML — a song's sidecar in `SongEditor` and a playlist in `Playlists`,
both through `@studio/ui-editor`'s `YamlPane` — and neither is handed a vocabulary. The completion machinery is
[packages/ui-editor/docs/completion.md](../../ui-editor/docs/completion.md); this
page is the other half, where the names here would have to come from.

## The library has no engine's disk

The editor fills its `Hints` from the project's file service: the project's modules, the tracks,
and the scan cache (`<state>/exts.json`) the engine writes beside it. The media library is
hosted. It serves a volume of files, has never seen a plugin scan, and will never see the one
belonging to the machine in front of you. A `hints()` computed here answers an empty object.

A useful vocabulary has to be asked for elsewhere, and where depends on the word:

| what is being written | vocabulary | who alone can answer |
|---|---|---|
| an `@engine/…` ref | the scanned plugins | the **engine**, over its socket |
| an `@k7-core/…` ref | the library's modules | the **catalogue**, over a listing route |
| a destination in a graph | the declared nodes | **the file itself**, in the buffer |

The third row is the one that costs nothing: the keys of the `modules:` section **are** the list
of nodes, so the vocabulary is read out of the text on screen. Such a vocabulary must let the
screen keep its last readable set when the text does not parse — one that emptied on every
keystroke would offer nothing precisely while the line that needs it is being written.

## The pattern that works here

A screen already holding a list for something else is best placed to make a vocabulary of it,
and needs to ask nobody. The editor's playlist screen does that over the listing it already queries
(`apps/k7/frontend/docs/playlists.md`), and this catalogue is what answers it, through
`/api/mediatek/list?family=songs`.

## Not covered

A song's sidecar. Its fields are not a project `FileKind`, so `fileKindFor` answers `null` and
nothing completes. It would be one more vocabulary on the model above.
