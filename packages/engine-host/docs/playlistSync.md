# Copying a set list onto a target

A **target** is somewhere this machine can put music: a stick, a folder, a network share the OS
has mounted. It has a name and a `file://` URI, it belongs to the MACHINE, and it is declared in `<state>/preferences.yaml` beside the
audio device and the stems chain.

```yaml
syncTargets:
  - name: Clé USB
    uri: file:///media/usb/MUSIC
  - name: Régie
    uri: file:///Volumes/regie/music
```

They are edited in the **tray's settings window**, on its Sync tab
([engine/st0-tray/docs/tray.md](../../../engine/st0-tray/docs/tray.md)) — the same window that ranks
the audio interfaces, and for the same reason. The file is hand-editable too; the normaliser below
treats both the same way.

## Why the machine holds it, and not pl8

Because a target is only reachable from here. `file:///media/usb` means nothing to a hosted
container, and a share on the rehearsal-room LAN is not on the internet. The same reasoning that
puts the stems chain in this file: it is a property of a machine rather than of an account.

A caller starts a run by **naming** the target, never by handing a URI over, so pl8 can never point a
run at a folder this machine did not declare.

## Folders only

`file://`, and a target whose URI is anything else is **dropped by the normaliser** rather than kept
and refused later: a dead entry in a dropdown is a button that cannot work, and the file is
hand-edited.

A box on the network is reached by **mounting** it, then naming the mounted folder. The OS then
holds the login, its reconnection and its encryption, and this file holds no credential at all —
a URI carrying a login is refused for the same reason. One way to write a file is also one rule
for "is it already there", `.part` included.

## The division of labour

| | who | why |
|---|---|---|
| resolve the playlist into tracks | **pl8** | it holds the catalogue; this machine has no songs list |
| hold the target and its URI | **this machine** | it is the only one that can reach it |
| fetch the bytes | **this machine** | through its tunnel, into its copy of the médiathèque |
| write them | **this machine** | into a folder it can already see |

So a `sync` job (`machineSync.ts`, asked over a jobs channel —
`packages/engine-tunnel/docs/jobs.md`) takes a target NAME and a list of tracks each carrying its
médiathèque path plus the three words that lay it out. This file therefore knows nothing about
songs, variants or sidecars — which is what keeps a second, disagreeing copy of "what is the
master" out of it.

## The bytes come one song at a time

The channel shares the médiathèque read-only, and each song is brought down through it **just
before it is written** (`JobContext.fetch`), not all before the run starts: a set list of thirty
songs would otherwise sit at 0 % for as long as the whole download takes. They land in the
machine's copy of the médiathèque, the one an engine plays from, so a song synced once is not
fetched again for the next sync or the next gig. A song the server does not have is one line in
the run, not a failed run.

No credential for the médiathèque lives on this machine: the tunnel is the way in, and its own
token the only secret.

## ADDITIVE — nothing is ever deleted

A track already on the target **at the same size** is skipped; one that is absent or a different size
is copied. Nothing on a target is removed, ever, whatever the set list says.

This is the deliberate answer to "sync", and the reason is that the destination is somebody's disk:
a URI one folder too high would otherwise delete what is under it. A wrong
target here costs some copied files, which is a cost you can undo.

Size and not a checksum: reading a whole target back to hash it — a stick, a share across the
network — would cost the transfer this is trying to avoid. A copy is written to a `.part` and
renamed, so an interrupted one never reads as a complete file of the wrong size.

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

## Reported as it goes

A copy is minutes and a person is watching, so the machine sends a report of the run on every
change and pl8 keeps the latest, which is what its `GET /api/sync/:id` answers. The percentage counts **tracks**, not
bytes: a bar driven by bytes would need a total this does not know until every file has been asked
for.

Jobs are forgotten ten minutes after they finish. Long enough to read the result of a long copy,
short enough not to be a leak in a service that runs for weeks.
