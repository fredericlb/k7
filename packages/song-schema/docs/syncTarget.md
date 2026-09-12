# A sync target, and the layout it is written in

The rationale behind `packages/song-schema/src/syncTarget.ts` — what a target URI may say, and how a
track and an m3u are NAMED on one. What a sync DOES with all of it, and why the machine holds the
URI, is [packages/file-service/docs/playlistSync.md](../../file-service/docs/playlistSync.md).

This file is here rather than beside the copying because it has no `node:` in it. The machine that
writes and the screen that offers the button read one definition of what a target is — a dropdown
saying `file:///media/usb` while the writer resolves something else is the bug this arrangement makes
impossible.

## Two schemes, and the URI parsed rather than pattern-matched

`file://` and `ftp://`, through `new URL`. Percent-encoding, credentials, a port and an empty path
all come out right for free, and a mount point called `Clé USB` arrives as those characters rather
than as `Cl%C3%A9`.

Three refusals are worth naming, since each is a URI somebody would reasonably write:

- **`file://otherbox/music`** — a file URI naming a host is a different machine's disk, which nothing
  here can write to. `localhost` is the legal spelling of "ours" and is kept.
- **`file:///`** — parses, and names nothing to copy into.
- **`sftp://`, `ftps://`, `smb://`, `http://`** — not promoted, not approximated. `sftp` is a
  different protocol from `ftp`, and a scheme quietly treated as another is worse than a refusal:
  somebody who wrote `ftps://` wants TLS, and getting a plaintext session instead is a security
  answer given by accident.

`null` rather than a throw, because this runs on a value out of a YAML file somebody typed. The
caller reports it beside the field it breaks — the preferences normaliser drops the target, so no
surface offers a button that cannot work.

## `safeUri` exists so a listing can be shown

An FTP target legitimately carries a password, and a listing crosses to a browser. `safeUri` blanks
it and leaves everything else legible, so a person can still tell two boxes apart in a dropdown.
It is what the target route answers with; the real URI never leaves the machine.

## `[artist]/[album]/[title].<ext>`

Fixed, and defined once here. The extension is the master's own — the bytes are copied, never
transcoded, so the name must keep saying what they are.

Segments go through `targetSegment`, which drops what a **FAT/exFAT** volume cannot hold. That is the
filesystem a stick handed to a player is formatted as, and it is stricter than every other target:
writing for the strictest means one layout rather than one per destination.

- `<>:"/\|?*` and the control characters become spaces, and runs of whitespace collapse to one — so
  `What: "Live"?` is `What Live` and not `What    Live`.
- A **trailing dot or space** is removed. Windows accepts one in a write and then cannot open the
  file, which is the worst shape a bug can have: it looks like it worked.
- An empty result becomes `Unknown Artist`, `Unknown Album` or `Untitled` rather than an empty
  segment, which would silently collapse the tree by one level and put an album's songs where the
  artist folders are.

## The m3u

`#EXTM3U`, a comment naming the playlist, then one line per track. No `#EXTINF`: that directive
carries a duration, nothing in this path ever decoded the audio to learn one, and a wrong duration in
a playlist is worse than an absent one.

Paths are **relative to the m3u's own folder** — `../AC-DC/Back in Black/Hells Bells.mp3`. That is
what the format means by a relative path, and it is what survives the target being mounted at a
different drive letter or mount point next time. An absolute path would be right exactly once.

CRLF, because the readers are car stereos and hardware players rather than text editors.

`m3uName` keeps only the **leaf** of a playlist filed under a folder: `live/repet` is `repet.m3u`,
since the target's `playlists/` folder is flat and a slash in a file name is not a folder there.
