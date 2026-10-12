# A playlist is a file — in the repository

A playlist is an ordered list of songs the **médiathèque** holds, each able to name one of its
song's variants. It lives under `_playlists/`, at the root of the workspace, at whatever depth you
like:

```
<workspace>/_playlists/ete-2026.yaml
<workspace>/_playlists/live/thursday-rehearsal.yaml
```

```yaml
# _playlists/live/thursday-rehearsal.yaml
title: Thursday rehearsal
items:
  - AC-DC/Back in Black/Hells Bells
  - song: Nirvana/Nevermind/Lithium
    variant: instrumental
  - song: Miles Davis/Kind of Blue/So What
    variant: sans-voix
```

## Here, and ALSO in the médiathèque — two homes, one format

The médiathèque holds set lists of its own, under `playlists/` on its volume
(`packages/ui-library/docs/playlists.md`). Same schema, same parser, same text edits: a file copied either way
is read by both. What differs is the job.

**A playlist here is the account's document, written for one specific piece of work.** A gig's
setlist belongs to the repository holding the songs played at it — under `_playlists/` it commits,
branches and clones with them, which is something a volume cannot do for it. That is also what lets
a `turntables` surface NAME one: the desk resolves `playlist:` in the workspace, and the machine
pre-fetches what it finds there.

**A playlist on the volume is one that sits beside the catalogue it points into**: reachable from
any browser with the session, with no machine up and no repository, and not versioned with anything.
It is the one you build while listening.

**The songs themselves stay put either way.** That is the point of the split and not a half-measure:
the file that names may be ours, the bytes named remain the médiathèque's. st0's playlist screen searches that catalogue
and deposits into it — see `apps/st0/frontend/docs/playlists.md`.

## `_playlists`, beside `_modules`

Same **kind** of folder, so same place and same rule: found by where it is, never by a line
declaring it (`docs/sharedFolders.md`). A playlist is not a project and has no business inside one
— you build a setlist once and open it from any project in the workspace.

Hence `Workspace.playlists()` working at the workspace root and not beside the active project. A four-song workspace would otherwise have four separate playlist folders,
which is exactly what a playlist is not.

And hence its being a **separate route** (`GET /playlists`) rather than a corner of `/tree`: that
tree is rooted on the active project, deliberately
(`packages/file-service/docs/activeProject.md`), so no walk of the open song can reach this
folder. Same reason as `/module-libraries`.

## The file IS the entry

There is no folder around a playlist, and no `playlist.yaml` marker inside one: **the extension is
the rule** (`PLAYLIST_EXT`), where a song, a chain and a module are folders because each carries
what its file names — a master, its nodes, its assets. A playlist carries only pointers; a folder
around it would be an empty box.

## Two spellings for one line

A line is either a string or a mapping:

| what you write | what it means |
|---|---|
| `- Nirvana/Nevermind/Lithium` | that song's master |
| `- {song: …, variant: instrumental}` | that version of that song |

The short form exists because it is what somebody actually types for the common case, and the long
form because a variant needs a second word. A line naming **no** song is thrown away rather than
salvaged: `- [x]` is a badly written line, and manufacturing `"[object Object]"` as a reference
would put a row on screen pointing at nothing you can go and look at.

The reference is **relative to `songs/`** — `AC-DC/Back in Black/Hells Bells` and not
`songs/AC-DC/…` — because that is what the médiathèque calls a song once the family is stripped,
and because a file holding both spellings would have neither.

## References are not checked here

`parsePlaylist` keeps `song` **verbatim**. Resolving a reference means holding the song catalogue,
and this file opens nothing — not even `node:fs`: that is what lets the file service and the
browser go by exactly the same rules.

So it is the job of whoever holds both lists — st0's screen
(`apps/st0/frontend/docs/playlists.md`) and the médiathèque's tab (`packages/ui-library/docs/playlists.md`), each with the
playlist on one side and the médiathèque on the other. They share the resolution itself rather than
each having a copy: `@studio/mediatek/playlistItems`, where "path first, name second" is written
once, since two copies would diverge at the first case learned on one side only.

## What the listing reads anyway

Two things, neither load-bearing: `title:` for what the list displays, and the item count. With no
title, the filename serves.

A file that **does not parse** is listed all the same, with `ok: false`. It is on disk: a listing
that hid it would leave you unable to click the very thing that needs fixing. `parsePlaylist`
returns `null` in that case, not an empty playlist — the two are different facts and a surface
says them differently: a file that does not parse is to be repaired, an empty `items:` is to be
filled.

## Writing a line without going through the serialiser

`appendPlaylistItem` adds a line **to the text**. Same discipline as `yaml/edit.ts` takes with a
project's files, for the same reason: these files carry comments and an order somebody chose, and
round-tripping through an object would throw both away silently.

It returns `null` — rather than an approximation — for shapes it cannot extend: a flow sequence
spread over several lines, or an `items:` that is not a list. The surface then disables its button
and says why; writing a second `items:` further down would produce a file whose two halves
contradict each other.

`yamlScalar` quotes **when it must and only then**. Song paths come out of `segment()` and so
legitimately carry spaces, `&` and parentheses — all fine unquoted mid-scalar, and not at all in
the lead. Quoted are: anything starting with an indicator, anything containing `: ` or ` #`, and
anything YAML would read as other than a string (`No`, `null`, `42`). Quoting everything would be
easier to write and would put two conventions in a file that is also hand-edited.

## Creating, and adding a line

Two **commands**, `playlist new <name>` and `playlist song add <playlist> <song> [variant]`
(`@studio/commands`) — the only ones in the catalogue acting on the repository (`repoDir`) rather
than on a project, which is exactly what a playlist is. They work with no project open.

`playlist new` writes the **template**, not an empty file: the screen draws its right-hand pane
from the text, so an empty file would open on a parse failure for a playlist nobody has yet had
the chance to get wrong. It adds the extension if missing — the extension is what makes the file —
and refuses a name already taken rather than opening it: a "create" that quietly handed back
someone else's setlist is how you edit the wrong one.

`playlist song add` goes through `appendPlaylistItem`, so through the TEXT: the comments and the
order written are still there afterwards. A shape the append cannot extend is refused by name,
never worked around by writing a second `items:` further down.

The name goes through `playlistPathOf`, which refuses a `..` segment — and the verb additionally
checks that the RESOLVED path stays under `_playlists/`, because that function splits on `/`:
`..\..\x` is one segment to it and three to `join` on Windows. It is the sentence `safePath` says
on the file-service side, said here for a path coming from a command line.
