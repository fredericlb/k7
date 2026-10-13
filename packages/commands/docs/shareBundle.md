# `project share link` — a frozen copy of a project, behind a link

```
project share link
```

Renders the project, packs it with the documents a browser draws it from, sends the lot to the media library,
and answers a secret. The link opens **st0 itself, read-only**: no account, no engine, no working
copy. Anyone who has it can listen and look; nobody can change anything, because there is nothing
on the other end that could be changed.

It is one more way a project leaves this machine, and the only one that shows the PROJECT:
`project export audio` downloads a mixdown, `project export video` the picture, and `project share k7`
publishes a release.

## "Every module is frozen" is one render, not N freezes

A render with `{ stems: true }` writes the mixdown **and** one wav per audible track in a single
pass, through a separate short-lived engine that opens no audio device — so a share runs while the
transport plays. That engine is this machine's, or an engine machine's when the host has no binary
(`packages/take-render/docs/rendering.md`).

Freezing module by module, the way `node freeze` does, would be N engine passes **and** would
write `frozen:` into N files of the project being shared. Nothing here writes to the project: it
reads a compiled document and produces bytes. What is given up is auditioning the signal at a
point *inside* a chain; a stem is a lane's output, which is what "mute this and listen" means.

## What is in a snapshot, and what is deliberately not

```
snapshot.json        the manifest — what plays, where, and how big
project-doc.json     WebProject — the arrangement
graph.json           WebGraph — the chains, the modules, their authored values
surfaces.json        what the project DECLARES, verbatim
audio/mix.wav        the mixdown
audio/s0.mp3 …       one per audible track
```

`WebProject` carries `sourceName` — the audio file's NAME and never its path — so it says what a
clip is called without saying where anything lives on this machine. `WebGraph` carries the chains
and the parameter values the files author: that **is** the feature.

`media.video` is **`false` stated rather than left out**. A project may declare a viewport surface,
and `surfaces.json` goes up verbatim so the snapshot never lies about the project; what the manifest
must say instead is which of those surfaces it CARRIES media for.

The renders are **moved, not copied** — they are already in the same temp directory, and a snapshot
of a long song is gigabytes. The caller owns `cleanup` and must call it, because the upload streams
from those files and they cannot go until it is done.

Three documents are missing on purpose. `video-doc` carries workspace-relative media paths
(`toWebVideoTracks`); `project-errors` quotes file paths and lines of YAML; `/tree` and `/file`
are the source itself. A share shows the song, not the folder it was made in.

The **mixdown stays WAV** — it is the one file a visitor may download, and a download is the one
place the format is theirs to keep rather than ours to stream. The **stems are mp3**, and the
number is why: on a twelve-lane song, wav stems come to **484 MB for one share**, with no expiry,
on the volume that also holds everybody's médiathèque. A stem is for hearing a lane in a
browser, so mp3 is not a compromise — it is what the file is for. ffmpeg missing costs the
compression and nothing else.

## The stem filenames are ours, never the engine's

`RenderManifest.stems[].name` is the TRACK's name, and a track name is a human string: it can hold
a slash, a quote, or the same characters as its neighbour. Those names would become segments of a
**public** URL.

So `stemSlots` gives every stem a slot id this file chooses (`s0`, `s1`, …), keeps the human name
as a label, and points each back at its track by name — reporting no track at all when two share
one, rather than guessing and lighting the wrong lane's mute button. It is the only place the
engine's output reaches a path, and it is where the traversal bug would be. It is pure and tested.

## The upload is three steps because the media library does not do multipart

Draft, then one raw `PUT` per file, then finish. Every media-library upload route is
`express.raw({ type: "*/*", limit: "512mb" })` — *a 400 MB master should never be a field in a form
parse* — and the global `express.json` is 8 MB, so the manifest travels as JSON and the audio does
not. `shareToK7`'s `FormData` is the rehearsal server's convention, not this one.

**`finish` is what makes the link answer.** Until then `pending.json` says "not yet" to every
public route, so a crashed upload is never reachable and short. The bytes are streamed
(`createReadStream`, `duplex: "half"`), where the k7 publish reads its one mp3 into a Blob.

The credential is the file service's own media-library bearer — `mediatekBase()` /
`mediatekToken()`, which the file hub hands it minted for the account it serves
(`packages/file-service/docs/mediatekLink.md`). Sharing needs no plumbing of its own. **Every** call
still names the user (`?user=`): three requests, none of which remembers the others, and a
`service:` token, which has no person, could not file a share without it.

## The address

`<origin>/@shares/<token>.st0`

`@` cannot begin a workspace name, so `@shares` can never collide with a workspace — the same
sentinel, for the same reason, as `@banc`. The `.st0` on the end is what makes the whole thing
work: `parseLaunch` ends a project at the last segment claiming the app's suffix, so the token
becomes the PROJECT part of an ordinary address and `parseLaunch`, `projectBasename` and every
route below them need no change at all.

That `@` is also the one character in this address with two legal spellings, and it is worth a
blank page: `encodeURIComponent` escapes it and RFC 3986 does not. A link carrying a literal `@`
against a basename carrying `%40` makes React Router — which compares the two verbatim — render
nothing at all. So `projectBasename` returns a **slice** of the path it was given rather than a
rebuild of it, which cannot disagree with the address the browser holds, and the two sentinels this
vocabulary mints are not escaped, so a link reads the way it is written.

The link is built **in the browser** (`shareUrl`), because the machine that rendered has no idea
which origin you are reading this on — a checkout, the LAN proxy and the public host are three
different answers, and only the tab knows which.

## What the author is told before it happens

The command asks first, and the question names what leaves rather than saying "are you sure": a
snapshot carries every track's name, every marker's name, every module's name and the text of
every note in the graph, to anyone the link reaches. That is the feature, and it is also the kind
of thing that ships without anyone thinking about it.

A share has no expiry. It lives until it is revoked, from st0's own home page — see
`apps/st0/backend/docs/media/shares.md` for where the bytes live and what revoking one actually does.
