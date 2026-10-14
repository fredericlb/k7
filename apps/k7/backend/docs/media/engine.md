# The engine registry, and what the library asks of an engine

`mountMedia` mounts the studio's **one** engine registry (`@studio/engine-registry`,
`packages/engine-registry/docs/shared.md`): the editor, the library's player and z0's editor all
list their engines from it, and every installed supervisor heartbeats to it.

## "pl8" is a file name, not an address

`mountEngineRegistry(app, { service: "pl8" })` keeps that name because it is only the file this
process advertises itself in, `~/.k7/web-endpoints/pl8.json`, which a machine's own file service
reads to find the médiathèque. It says nothing about where the registry answers: that is k7's
origin, and the `play.` alias host for the supervisors that saved it
(`packages/web-protocol/docs/addresses.md`). Renaming it would orphan the file every local file
service already looks for.

## The host owns the signals

The registry is mounted with `exitOnSignal: false`. Its own handler would exit the process inside
SIGTERM, before the account file services stop and before the requests in flight drain; k7's
`server.ts` owns both signals instead and calls the registry's goodbye as the first step of its
stop, then the file hub's, then `server.close`.

## What the library asks of a machine: a copy, and a cut

The moteur opens file PATHS and cannot fetch a URL, so a song played on an engine is the copy on
that machine's disk: `POST /api/engine-local` brings it there through the engine's tunnel and
answers with the machine's own path ([playbackTarget.md](playbackTarget.md)). A cut into stems is
the other job sent the same way ([stems.md](stems.md)). Both go through the tunnel
(`packages/engine-tunnel/docs/jobs.md`): there is no file service on that machine for a browser to
call, and a page on HTTPS could not call one there anyway.

## What it does NOT ask: an analysis

A `{file}.cache` sidecar is written by **this backend**, out of its own ffmpeg, because this
backend holds the bytes (`packages/audio-analysis/docs/analysis.md` and [analysis.md](analysis.md)).
Asking a machine for it would mean downloading the master to that machine first and posting the
sidecar back, to compute something the host already has everything for. That is also why an engine
may be absent without anything in the library degrading except playback on it.
