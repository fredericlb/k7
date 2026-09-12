# Copying a set list onto a target

A **target** is somewhere this machine can put music: a stick, a folder, an FTP box. It has a name
and a URI, it belongs to the MACHINE, and it is declared in `<state>/preferences.yaml` beside the
audio device and the stems chain.

```yaml
syncTargets:
  - name: Clé USB
    uri: file:///media/usb/MUSIC
  - name: Régie
    uri: ftp://dj:s3cret@box.lan/music
```

They are edited in the **tray's settings window**, on its Sync tab
([engine/st0-tray/docs/tray.md](../../../engine/st0-tray/docs/tray.md)) — the same window that ranks
the audio interfaces, and for the same reason. The file is hand-editable too; the normaliser below
treats both the same way.

## Why the machine holds it, and not pl8

Because a target is only reachable from here. `file:///media/usb` means nothing to a hosted
container, and an FTP box on the rehearsal-room LAN is not on the internet. The same reasoning that
puts the stems chain in this file: it is a property of a machine rather than of an account.

It has a second consequence that is the point rather than a side effect: **the URI never leaves this
machine.** A listing blanks the password (`safeUri`), and a caller starts a run by naming the target,
never by handing one over. So pl8 — the service holding everybody's session and the one deploy key —
never sees a credential for anyone's FTP server.

## Two schemes, and why not a third

`file://` and `ftp://`, and a target whose URI is neither is **dropped by the normaliser** rather
than kept and refused later: a dead entry in a dropdown is a button that cannot work, and the file is
hand-edited. `sftp://` is a different protocol and is not silently promoted to it — someone who wrote
one meant it, and being told is the remedy.

`ftps://` is not accepted either, so the FTP client never negotiates TLS behind a URI that did not
ask for it. A scheme that said one thing and did another would be the worst of the three answers.

## The division of labour

| | who | why |
|---|---|---|
| resolve the playlist into tracks | **pl8** | it holds the catalogue; this machine has no songs list |
| hold the target and its URI | **this machine** | it is the only one that can reach it |
| fetch the bytes | **this machine** | from the hosted médiathèque, over its own link |
| write them | **this machine** | one writer per scheme, and the sync knows neither |

So `POST /sync` takes a target NAME and a list of tracks each carrying its médiathèque path plus the
three words that lay it out. This file therefore knows nothing about songs, variants or sidecars —
which is what keeps a second, disagreeing copy of "what is the master" out of it.

## The bytes do not land here

Each track is fetched from the médiathèque and piped **straight into the writer**. Nothing is
written to this machine's disk on the way, and no cache is filled: a sync of thirty songs onto an FTP
box would otherwise cost a gigabyte here for files nobody asked to keep.

That is also why this is not built on `mediatekPull`. That loop MIRRORS what the open projects name,
onto this disk, and is a different job with a different lifetime.

The one thing it needs is the machine's médiathèque link (`mediatekLink.ts`). Without one there is
nothing to copy FROM, and the job fails saying so rather than writing an empty tree.

## ADDITIVE — nothing is ever deleted

A track already on the target **at the same size** is skipped; one that is absent or a different size
is copied. Nothing on a target is removed, ever, whatever the set list says.

This is the deliberate answer to "sync", and the reason is that the destination is somebody's disk:
a URI one folder too high, or a mistyped FTP root, would otherwise delete what is under it. A wrong
target here costs some copied files, which is a cost you can undo.

Size and not a checksum: reading a whole FTP target back to hash it would cost the transfer this is
trying to avoid. A server that answers no size at all reports `null`, which reads as "copy it" — the
safe direction.

A track that fails is **one line in the job**, not the end of the run. A set list that stopped at its
third song because one file was locked is not a sync.

## `[artist]/[album]/[title]`

The layout is fixed and lives in `@studio/song-schema/syncTarget`, so the machine that writes and any
screen that explains it read one definition. The extension is the master's own — the bytes are copied
as they are, never transcoded.

Segments are scrubbed of what a **FAT/exFAT** volume cannot hold, that being what a stick handed to a
player is formatted as: `<>:"/\|?*`, the control characters, and a trailing dot or space, which
Windows accepts in a write and then cannot open. An empty segment becomes `Unknown Artist`,
`Unknown Album` or `Untitled` rather than collapsing the tree by one level.

Variants are **ignored**: a target holds one file per song and it is the original. A player on a
stick has no vocabulary for "the same song, three ways", and a folder holding two files with one
title is what makes a device show duplicates.

## The m3u, only where there is already a folder for one

If the target has a **`playlists/` folder**, the run writes `playlists/<name>.m3u` into it. If it has
not, nothing is written and the sync is a success all the same.

Never created, and that is the rule rather than an omission: the folder is what a device uses to say
"I read playlists, and this is where I keep them". Making one on a target that never asked would put
a file no player will look at onto somebody's stick.

Paths inside it are relative to the m3u's own folder — `../AC-DC/Back in Black/Hells Bells.mp3` —
which is what the format means by a relative path, and what survives the target being mounted at a
different letter or mount point next time.

`#EXTM3U` and a comment, and no `#EXTINF`: that directive carries a duration, and this run never
decoded anything to learn one. A wrong duration in a playlist is worse than an absent one.

A playlist filed under a folder (`live/repet`) keeps only its **leaf** in the m3u's name, since the
target's playlists folder is flat.

## Start-then-poll

A copy is minutes and a person is watching, so `POST /sync` answers with a job and `GET /sync/:id`
follows it — the shape `/separate` uses, for the same reason. The percentage counts **tracks**, not
bytes: a bar driven by bytes would need a total this does not know until every file has been asked
for.

One FTP connection is held for the whole run and closed in a `finally`. A login per track is most of
the wall-clock time of a sync onto a slow box.

Jobs are forgotten ten minutes after they finish. Long enough to read the result of a long copy,
short enough not to be a leak in a service that runs for weeks.
