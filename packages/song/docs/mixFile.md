# mix.yaml — a set's CUE SHEET

```yaml
cues:
  - ref: "@k7-core/songs/lemo/mante/danse"
    markers: [ 12.5, null, 48.25 ]
```

The only file a set has that a song has no counterpart for, and the only place a project names
the médiathèque's **songs** rather than its modules.

## It is not `views/mix.yaml`

Same base, different file, and the two have nothing to do with each other. A `views/mix.yaml`
holds the desk's *bindings* — which module each fader moves — and a surface carries its
`mapping:` instead, so a scaffolded set has none. This one is at the **root** of the project and
holds where the needle drops.

`validate.ts` tells them apart by folder, and the order of its two branches is what does it: the
`views/` test comes first, so a root `mix.yaml` falls through to this schema.

## It is not the set list either

Which songs the set draws on is answered by the **playlist the desk's surface names** —
`playlist:` in `surfaces/<desk>.yaml`, a file in the workspace's `_playlists/`
([playlists.md](playlists.md)). A set carrying a `songs:` by hand is TOLD — the schema is
`.strict()`, so it is refused by name rather than read as an empty sheet with every cue silently
gone.

Of the two documents, the playlist is the better place for a list of songs: it has a SCREEN
(k7's cog opens it), it can be shared between sets and reused next season, and it is the thing
somebody has already written by hand. What stays here is the half a playlist has nowhere to put:
**the cues**. A cue belongs to the desk that plays a song rather than to a list other sets read —
two bands covering the same track drop the needle in two different places, and a playlist
carrying one set's marks would hand them to the other. So an entry appears here when somebody
drops a cue, not when somebody adds a song.

Everything below describes this file, except the two sections about the CACHE, which describe
what the playlist does — kept here because the reasoning is the same one, and it is the reasoning
that is worth having.

## A ref is `@k7-core/` plus the médiathèque id, verbatim

A `MediatekEntry.id` is the entry's library-relative POSIX path, and the catalogue's own note
says nothing else survives a rescan — there is no rowid, because there is no database. A ref that
**is** the id needs nothing resolved to be compared, deduplicated, sorted or fetched: resolution
is a map lookup, not a computation, and a ref that resolves to nothing is still a perfectly good
name for the thing to go and fetch.

Not a path: `project.yaml` is committed, and an absolute path breaks on the next machine. Not a
title either — two songs share one.

The refs must be **quoted**. `@` is a reserved indicator in YAML, so a plain scalar may not open
with one. `graphFile.md` has the same note for module refs, and for the same reason.

### Why it looks a segment longer than a module ref

`@k7-core/audio/reverb` means `modules/audio/reverb` — a module ref omits its own family. A song ref
carries `songs/` because it is the id.

The two are not made consistent: they are read by different files with different functions
(`mediatekRefs` against `mediatekSongRefs`), each mapping to its own path prefix. Nothing has to
tell them apart at a distance, which is what would make the inconsistency expensive.

## Unordered

The list has no running order. The argument is about a SET LIST — which songs you brought, not
the order you will play them in, the order being a live decision — and it holds for the playlist
too, whose lines are sorted for display
([setList.md](../../../packages/k7-plugins/docs/turntables/setList.md)).

Here it means something smaller: the order cues are written in is the order they were dropped in,
and nothing reads it.

Duplicates are dropped rather than refused. Two people merging their halves of a file should not
have to resolve that by hand.

It is a **sequence** and not a map, although `graph.yaml` uses a map for exactly this "named
once" property. That decision is the load-bearing one — see the last section: a bare ref and a
ref carrying markers are the same shape, so cues need no migration.

## What the SET LIST is for: the machine must already have the songs

*(This section describes the playlist. It stays here because the reasoning was worked out for
this file, and `mediatekSongRefs` answers the question by reading the surface and then the
playlist, rather than by reading this.)*

The machine that plays the set opens **file paths** — the engine cannot fetch a URL. So every
song in the set has to be on that machine's disk before you need it, and the venue has no wifi.
`mediatekSongRefs` answers "what does the open project reach for", reading the refs **off the
YAML before anything resolves them**, precisely because a ref that resolves to nothing is the one
worth fetching. The server sends those songs to the engine's machine ahead of time
(`packages/file-service/docs/mediatekPrefetch.md`).

So the set list is a **cache manifest** that happens also to be the thing you look at. Any shape
that made that awkward — titles, a database, an order that mattered — would fail at the job it
actually does. The one thing the playlist adds is that a line naming a song by its bare TITLE
cannot be fetched, since resolving one needs the catalogue this loop exists to populate. Such a
line is skipped, and arrives at the desk as a song the cache has not got — which is what it is.

Two consequences worth stating:

- A song ref syncs the **folder**, trailing slash and all (`songPathPrefix`), because a song IS
  its folder: the master, its variants, `song.yaml`. A sync that fetched only the file named
  would land a catalogued folder with nothing to play.
- Pulling one set's songs never evicts the rest of what the machine holds. Adding a set to a
  machine is additive.

## The refs stay live

A ref names the médiathèque entry, and resolves at load, every load. Fix a song in the
médiathèque — a better master, a corrected title — and every set naming it is fixed, with nothing
to re-import. This is the same contract a module ref has, and it is why both are refs rather than
copies.

The cost is that a set is not a snapshot: what played last winter is not necessarily what plays
now. That is the right trade for a médiathèque that is curated rather than archival, and the day
it is not, the thing to add is a pinned revision beside the ref — not a copy of the audio.

## A song the cache has not got is a state, not an error

`resolveSet` (in `@studio/ui-turntables`) keeps the ref whatever happens and reports
`entry: null`. The sync fetches what the open project names, so a set edited a minute ago is
briefly ahead of the disk — that is ordinary. It draws as a song that is **coming**, with its
name taken from the id's last segment.

Dropping it from the list would make a set that is missing three songs look exactly like a set
that never had them, on the one screen where that difference matters most.

## An entry may carry settings — and that is all it carries

`cues:` is not a table. An entry is **either** a bare ref **or** a ref carrying something:

```yaml
cues:
  - "@k7-core/songs/artiste/album/titre"
  - ref: "@k7-core/songs/artiste/album/autre"
    markers: [ 12.5, null, 48.25 ]
```

Both forms coexist on purpose. A song with nothing to say fits on one line — so all of them,
until somebody drops a cue — and a list of bare refs reads as it is, with no migration. A table
of refs pointing at almost nothing would make every entry look as though something were missing.

`markers` are the desk's eight cue points, positional, in seconds within the FILE:
[packages/k7-plugins/docs/turntables/cues.md](../../../packages/k7-plugins/docs/turntables/cues.md). The file is written by the desk,
mid-set, and `withMarkers` edits it **in its text** — the scaffold's comments are the only worked
example a reader gets, and a desk that ate them on the first cue dropped would not be forgiven.
