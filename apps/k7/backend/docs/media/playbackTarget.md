# Where a song plays — the server's half

Where the médiathèque makes sound is a choice the listener makes in the playback picker; the
menu, the fallback and the transport are the screens', in
[packages/ui-library/docs/playbackTarget.md](../../../../../packages/ui-library/docs/playbackTarget.md).
The backend holds three things of it.

## The preference is a string, not an enum

`playbackTarget` sits in the one preferences document per person (`prefsSchema` in
`apps/k7/backend/src/server.ts`), beside `engineId` and the editor's command preferences. It is
`z.string()` and not a `z.enum`: a new destination is an entry in the screens' list plus a branch in
whatever plays, and an enum here would make the vocabulary something the backend and every build of
the frontend have to agree on before either can move. An id a build has never heard of reads as
the default on that side.

## The moteur needs a path on ITS disk: `POST /api/engine-local`

The engine opens file PATHS on its own machine and cannot fetch a URL, so before a song plays there
the screen asks `/api/engine-local` where it is on that machine
(`apps/k7/backend/src/media/routes/engineLocal.ts`). The backend brings the song down through the
engine's tunnel into the machine's copy of the médiathèque (`packages/engine-tunnel/docs/jobs.md`)
and answers with the machine's own path, in the machine's own spelling — so the answer is never a
path to nothing. A song is on a machine because it was asked for there, and stays for the next time.

Each way it can fail is its own answer, because each is fixed differently: no engine with a tunnel
here, a path that is not in the médiathèque, anything else in the machine's own words.

## The host's own speakers: mpv

The `library` destination plays through `mpv` on the host that serves the files
(`packages/mpv-player/docs/mpvPlayer.md`), mounted by `mountMedia` under `/api/player/*`. A path is
resolved against the library's root, which is also the guard: a client can name only what that
root holds. mpv missing on the host is a 503 with the sentence, on the one route that needs it.
