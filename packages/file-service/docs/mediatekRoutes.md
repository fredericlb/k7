# routes/mediatek.ts — the médiathèque, read-only

The library is written by k7's backend (`apps/k7/backend/src/media/`); these routes only read it,
for a surface that reaches this service rather than the backend — the DJ desk. Mounted BEFORE
`resolveWorkspace`: the library belongs to no workspace, the way `/workspaces` belongs to none.

## `GET /mediatek` and `GET /mediatek/list`

`GET /mediatek` reports what the library holds and where — `present: false` is normal, never a
404. `GET /mediatek/list` answers one family's entries, stamped with the token they were read at,
and refuses a bogus family with the same sentence the backend uses (`FAMILY_ERROR`).

## `GET /mediatek/file` — one file's BYTES

The catalogue says where a thing is; it never says what is in it. That is enough for anything
that lists the library or hands the moteur a path, but a browser that has to read a module's
`plugin:` block has neither a filesystem nor a way in. This is that way in, and it is read-only:
writing belongs to the backend, which bumps the change token every listing is keyed on.

`readablePath` confines every path to the library root, lexically and via realpath, and refuses a dot
segment — the same guard the hosted service uses, this one being reachable from a second app. A
path that escapes is the caller's mistake: 400, never 500.

The mime is REQUIRED: `streamFile` sets it unconditionally, so an `undefined` throws inside
`res.setHeader` and the route answers 500 for every file it is asked for. The library
serves audio, video, YAML and JSON, so it is guessed from the extension rather than pinned — and
octet-stream is the honest default, not a lie about the content.

## `GET /mediatek/envelope` — the waveform, as JSON

The sidecar (`{file}.cache`) is already beside the audio in the library, so this is nearly always a
read: `ensureFileEnvelope` returns it when the fingerprint still matches. When it does not, or a
song landed here without ever being analysed, the engine on THIS machine computes it and writes
the sidecar; that is slow (seconds for a long track) and is why the caller draws "analyse…"
rather than an empty box.

JSON and not the raw sidecar bytes: the file is an internal format with a version and a
fingerprint in it, and a browser that parsed it would be a second implementation of `readSidecar`
waiting to drift. ~120 KB for a five-minute track, 8192 buckets.

No engine on this machine is a 503 and not a 500: it is a state a laptop is legitimately in, and
the deck says so rather than looking broken. `ensureFileEnvelope` throws ENOENT of its own for a
file the library has not got, which is why there is no separate existence check to get out of step
with it.
