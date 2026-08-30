# The médiathèque with no médiathèque

pl8 holds the catalogue, and offline there is no pl8. But this machine already keeps a **cache**
of it — the file service serves `/mediatek/{list,search,revision,file}` out of the same
`@studio/mediatek` catalogue pl8 does. So the panel browses what is here rather than showing an
empty list.

Four read routes are mapped onto it, under the prefixes each side uses:

```
GET /pl8/api/mediatek/<r>   →   GET http://127.0.0.1:<filePort>/mediatek/<r>
```

for `r` in `list`, `search`, `revision`, `file`. Everything else — `manifest`, `variant`, `bpm`,
`key`, `recordings` — falls through to the shim, because inventing an answer for a route this
machine has no data for is worse than saying no.

## Reads only

An **upload has nowhere to go**. `POST /api/mediatek/song` stays the shim's 503: the catalogue
belongs to pl8, and writing into the local cache would make a copy that the next sync would
either overwrite or duplicate. `apps/pl8/docs/projects.md` argues the same about the register
and for the same reason.

## The two things beyond "it forwards"

**A song has to stay seekable.** `/mediatek/file` is an `<audio>` source, and an element seeks
by asking for a byte range. So `Range` goes out and `Content-Range` / `Accept-Ranges` come
back, and the body is **streamed** rather than buffered — a song is not a JSON reply.

**The file service gates on headers.** `requireEngineToken` and `resolveUser`, and deliberately
no workspace: `file-service/src/server.ts` says it in as many words — *"The media library is per
MACHINE: the user for the gate, and no workspace."* So the proxy carries
`x-studio-engine-token` from `<state>/engine-id.json` and `x-studio-user` from the app's
identity (`docs/identity.md`). The query-token path is `/media`'s alone and does not apply here.

## Where it sits

Behind the remote proxy and in front of the shim: **with** a server the server wins, **without**
one the cache answers, and anything neither can serve gets the shim's sentence. A second device
on the LAN reaches it too, which is consistent — the file service already serves that device
the same routes directly, and `docs/remote.md` makes the LAN the trust boundary.

## What stem separation needed

`POST /pl8/api/stems` was **session-only** on pl8, so it 401'd from the desktop, which has no
cookie jar. It now takes `bearerOrSession` like the médiathèque and the projects do.

`/api/hunt` deliberately did **not** move, and it would have been easy to widen both together.
`apps/pl8/docs/hunt.md` is explicit: that route spends an account's bandwidth and reputation on
a peer network, which is a different thing from borrowing an engine the caller already named.
