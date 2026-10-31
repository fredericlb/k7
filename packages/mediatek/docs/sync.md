# Reading another library — extended notes

`remote.ts` is the HTTP client one library uses to read another: the device's library copying from
a server's (`serverCopy.md`), the rehearsal recorder fetching a take's bytes. The library itself
always lives on one volume; what crosses the wire is a manifest and files.

## The manifest is the OWNER's description

`manifest.ts` describes a family as `(path, size, mtime)`, and the mtime is the one the owner
reports. A downloaded file has its own mtime — the moment it was written locally — so a local
`stat` compared against the owner's manifest would call every file changed, every time. Local
timestamps never enter a comparison with what another library said.

No content hash: reading every file to decide whether to read every file costs more than the
thing it guards — the same trade `workspace.ts` makes, written down in index.md.

## A copy remembers the owner's rows, not its own stat

So a copy that must later know whether it is still current keeps what the OWNER said: a song that
follows its server holds the server's manifest rows for it, and the songs revision they were read at,
in `.synced.json` inside its folder (`src/synced.ts`). The next check compares the owner's next
manifest with those rows — owner against owner — and the revision first, which spares the manifest
when nothing moved. Dot-named, the sidecar is skipped by the manifest walk, the scan and the change
token alike, so it never travels and never looks like an edit.

## A download goes through `.part`

`download()` writes to `<dest>.<uuid>.part` and renames at the end. A truncated master installed
under its real name is worse than a missing one: nothing says it is short, it plays until it stops.
The rename is atomic on one filesystem, so what appears under the real name always arrived whole;
a failure leaves nothing at all. On Windows that rename can be refused while another process holds
the destination open; `rename.md` is how that is answered.

## `terminated` says nothing, and the format is at fault

`fetch` reports a transport failure in two words — `fetch failed` or `terminated` — and files the
real reason in `cause`. A caller that settles for `e.message` therefore surfaces one word that
can mean six things: "analysis impossible: terminated", in a browser, about a download between
two servers.

`why()` flattens the `cause` chain into the message, because the message is the only field that
survives the trip back through HTTP to a browser:

```
mediatek GET https://app.priv.k7.rocks/api/mediatek/file songs/…/original.flac:
  terminated ← other side closed (UND_ERR_SOCKET)
```

The address is part of it deliberately: `MEDIATEK_URL` is handed in by whatever started the caller
rather than typed by anyone, so "which médiathèque did it even try" is half the answer every time
the answer is "the wrong one".

| cause | what happened |
|---|---|
| `other side closed (UND_ERR_SOCKET)` | the host closed before the announced body ended — often a service restarted mid-download, which `tilt` does on every save |
| `unable to verify the first certificate` | an authority node does not know — a local private-CA proxy in front of the service |
| `ECONNREFUSED` | nobody is listening at that address |
| `UND_ERR_BODY_TIMEOUT` | the body stopped arriving without the connection dropping |

There is **no** retry: a master download is long, and retrying silently would turn a visible
cause into twice the wait. The `.part` does make a retry safe, if use ever asks for one.
