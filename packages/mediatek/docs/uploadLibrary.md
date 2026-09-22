# Bulk-uploading a local library

`scripts/uploadLibrary.ts` pushes a local `<artist>/<album>/<title>/` tree into a HOSTED pl8, one
song per leaf folder holding an audio file:

```bash
npm run upload-library --workspace @studio/mediatek -- \
  --root /path/to/library --url https://play.example.com --token <bearer token>
```

## The folder is not required to already be a médiathèque

`findSongs` walks the given root itself for three levels of subfolders and stops at the first
audio file it finds in each — no `mediatek.yaml` marker, no `songs/` prefix, no prior sidecar
required. An ordinary `Artist/Album/Title/track.flac` collection, organised by hand, is enough;
the artist/album/title are read straight off the folder names.

A `song.yaml` sidecar already in a leaf folder is used instead, field by field, where it has a
non-empty value — an unreadable or malformed one is treated as absent rather than refused. This
is what lets the script also re-upload FROM an existing médiathèque-shaped export, whose folder
names and sidecar tags should agree anyway.

## What it pushes, and what it does not

Only the master, via `pushSong` — the same route (`POST /song`) and the same folder derivation
(`songFolder`, `docs/songs.md`) an interactive upload goes through, so a song this script filed
looks no different from one someone dragged into the browser. Stems and variants are not
uploaded: `remote.ts` has no route for them yet, so a folder holding more than the master's own
file only ever contributes that one file.

## Re-running is safe

A song already at its destination folder answers 409, reported as skipped rather than a failure
— re-running the script over a library it has already pushed costs one request per song, not a
duplicate upload. `--replace` turns that 409 into an overwrite, for a library that has since
changed.
