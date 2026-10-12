# Playlists — the routes

A set list on the volume is a YAML file under `playlists/`, in the format
`packages/song-schema/docs/playlistFile.md` defines; what the volume does with them is
`packages/mediatek/docs/playlists.md`, and the screen is
[packages/ui-library/docs/playlists.md](../../../../../packages/ui-library/docs/playlists.md).

## A listing of its own, and a create — nothing else

`GET /api/mediatek/playlists` lists the zone, because no family scan reaches it: a set list names
songs and carries no bytes, so it is a root zone and not a family. `POST /api/mediatek/playlists`
creates one from the stub, and answers 409 on a taken name — the caller asked for a NEW one, and
this is not a retry.

Reading and writing a playlist are the ordinary `/file` and `PUT /file`. A playlist is a file, and a
route of its own to save one would be a second write path that could disagree with the first about
what a valid file is. The screen validates before it writes; the backend writes what it is sent.
