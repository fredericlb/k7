# Where a song plays — the server's half

A song plays on the engine the account chose, and in the browser while none answers; the fallback
and the transport are the screens', in
[packages/ui-library/docs/playbackTarget.md](../../../../../packages/ui-library/docs/playbackTarget.md).
The backend holds one thing of it.

## The moteur needs a path on ITS disk: `POST /api/engine-local`

The engine opens file PATHS on its own machine and cannot fetch a URL, so before a song plays there
the screen asks `/api/engine-local` where it is on that machine
(`apps/k7/backend/src/media/routes/engineLocal.ts`). The backend brings the song down through the
engine's tunnel into the machine's copy of the médiathèque (`packages/engine-tunnel/docs/jobs.md`)
and answers with the machine's own path, in the machine's own spelling — so the answer is never a
path to nothing. A song is on a machine because it was asked for there, and stays for the next time.

Each way it can fail is its own answer, because each is fixed differently: no engine with a tunnel
here, a path that is not in the médiathèque, anything else in the machine's own words. An engine
the caller holds no claim on is a 403 before any of them: anyone may register an engine, and a
song is sent only to the one this account is driving (`packages/engine-registry/docs/claim.md`).
