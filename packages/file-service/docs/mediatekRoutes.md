# routes/mediatek.ts — the media library as THIS MACHINE holds it

The library itself is hosted (`apps/st0/backend/src/media/`); what lives here is a cache the moteur plays
from, so these routes report what is cached and pull down what is missing. Mounted BEFORE
`resolveWorkspace`: a cache is per machine, the way `/workspaces` is per user.

## `POST /mediatek/analyse` — because the hosted library has no engine

st0's image holds no engine, and the engine is what owns decoding — so the
hosted library holds the bytes and this machine, which has one, does the work and hands the
result back.

The round trip is: download into the local cache (where the moteur would play it from anyway),
run the engine, push the `{file}.cache` sidecar up beside the audio, and report the tempo so the
caller can seed `song.yaml` with it. The next machine to want this file then finds a sidecar
already there.

`path` names a file in the LIBRARY, never a local one: `safePath` confines it, and the download
source is configuration rather than a parameter — the same rule `/mediatek/sync` states, so a
browser cannot point this machine's downloader somewhere else.

The file is always re-fetched rather than trusted: the caller asks for this right after an
upload, and a cache entry from a previous version of the same path would be analysed instead.
The envelope memo is then invalidated, because it is keyed on mtime while the fingerprint is the
truth.

A fetch failure is logged HERE as well as answered: this is the machine that actually tried, and
its log is where somebody looks when a browser three hops away says the analysis failed.

The two soft failures are deliberate. A sidecar that could not be stored still leaves a good
analysis and a tempo worth reporting, so the reply says what failed rather than throwing away
work the caller asked for. And the tempo push is best effort: a song whose bpm somebody already
set answers `set: false`, which is not a failure, and a library that refuses the write must not
lose the cache just stored.

## The cache's own answers

`GET /mediatek` reports what this machine holds and where — not the catalogue, which is the
hosted service's answer. `present: false` is normal, never a 404.

`POST /mediatek/sync` pulls one family's cache in line with the hosted library. Configured, not
requested: the caller says WHICH family, never where to fetch from. Only a clean sync counts as
caught up — otherwise the missing files would never be retried.

`GET /mediatek/revision` returns every family's change token in one call, so a surface polls this
and refetches only the listing that actually moved. That is the whole reason the tokens are per
family.

## `POST /mediatek/import` uploads rather than copies

The local folder is a CACHE: anything put there by hand is absent from the owner's manifest, and
the next sync deletes it. So this uploads to the hosted library rather than copying a workspace's
files down into that folder.

The workspace is resolved from the AUTHENTICATED user, not from anything the caller sends beyond
a name, so this cannot be pointed at somebody else's folder; `assertWorkspaceName` refuses
anything that is not one plain path segment.

## `GET /mediatek/file` — one cached file's BYTES

The catalogue says where a thing is; it never says what is in it. That is enough for anything
that lists the cache or hands the moteur a path, but a browser that has to read a module's
`plugin:` block has neither a filesystem nor a way in. This is that way in, and it is read-only:
writing to the cache is what a sync is for, and a route that let a caller edit it would produce
files the next sync silently deletes.

`safePath` confines every path to the cache root, lexically and via realpath — the same guard the
hosted service uses, this one being reachable from a second app. A path that escapes is
the caller's mistake: 400, never 500.

The mime is REQUIRED: `streamFile` sets it unconditionally, so an `undefined` throws inside
`res.setHeader` and the route answers 500 for every file it is asked for. A cache
serves audio, video, YAML and JSON, so it is guessed from the extension rather than pinned — and
octet-stream is the honest default, not a lie about the content.

## `GET /mediatek/envelope` — the waveform, as JSON

The sidecar (`{file}.cache`) is already beside the audio in the cache, so this is nearly always a
read: `ensureFileEnvelope` returns it when the fingerprint still matches. When it does not, or a
song landed here without ever being analysed, the engine on THIS machine computes it and writes
the sidecar; that is slow (seconds for a long track) and is why the caller draws "analyse…"
rather than an empty box.

JSON and not the raw sidecar bytes: the file is an internal format with a version and a
fingerprint in it, and a browser that parsed it would be a second implementation of `readSidecar`
waiting to drift. ~120 KB for a five-minute track, 8192 buckets.

No engine on this machine is a 503 and not a 500: it is a state a laptop is legitimately in, and
the deck says so rather than looking broken. `ensureFileEnvelope` throws ENOENT of its own for a
file the cache has not got, which is why there is no separate existence check to get out of step
with it.
