# songs.yaml — a set's CUE SHEET

```yaml
songs:
  - ref: "@st0/songs/lemo/mante/danse"
    markers: [ 12.5, null, 48.25 ]
```

The only file a set has that a song has no counterpart for, and the only place a project names
the médiathèque's **songs** rather than its modules.

## It was the set list, and is not any more

It said which songs the set drew on. That question is answered by the **playlist the desk's
surface names** now — `playlist:` in `surfaces/<desk>.yaml`, a file in the workspace's
`_playlists/` ([playlists.md](playlists.md)).

Nothing was wrong with this file; there were simply two of them. And of the two, the playlist
is the better answer: it is a document with a SCREEN (st0's cog opens it), it can be shared
between sets and reused next season, and it is the thing somebody had already written by hand.
A list of refs in a project folder could be none of those.

What stayed is the half a playlist has nowhere to put: **the cues**. A cue belongs to the desk
that plays a song rather than to a list other sets read — two bands covering the same track
drop the needle in two different places, and a playlist carrying one set's marks would hand
them to the other. So an entry appears here when somebody drops a cue, and not when somebody
adds a song.

Everything below still describes the file, and the two sections about the CACHE describe what
the playlist does now — kept because the reasoning is the same one, and it is the reasoning
that is worth having.

## A ref is `@st0/` plus the médiathèque id, verbatim

A `MediatekEntry.id` is the entry's library-relative POSIX path, and the catalogue's own
note says nothing else survives a rescan — there is no rowid, because there is no database.
A ref that **is** the id needs nothing resolved to be compared, deduplicated, sorted or
fetched: resolution is a map lookup, not a computation, and a ref that resolves to nothing
is still a perfectly good name for the thing to go and fetch.

Not a path, for the reason `modules_from` is gone: `project.yaml` is committed, and an
absolute path breaks on the next machine. Not a title either — two songs share one.

The refs must be **quoted**. `@` is a reserved indicator in YAML, so a plain scalar may not
open with one. `graphFile.md` has the same note for module refs, and for the same reason.

### Why it looks a segment longer than a module ref

`@st0/audio/reverb` means `modules/audio/reverb` — the module vocabulary predates the
médiathèque having families, and omits its own. A song ref carries `songs/` because it is
the id.

The two are not made consistent. Rewriting every song already written would cost more than
the asymmetry, and the two are read by different files with different functions
(`mediatekRefs` against `mediatekSongRefs`), each mapping to its own path prefix. Nothing
has to tell them apart at a distance, which is what would make the inconsistency expensive.

## Unordered

The list has no running order, and never did. That argument was about a SET LIST — which songs
you brought, not the order you will play them in, the order being a live decision — and it
survives its move to the playlist, whose lines are sorted for display too
([setList.md](../../ui-turntables/docs/setList.md)).

Here it means something smaller: the order cues are written in is the order they were dropped
in, and nothing reads it.

Duplicates are dropped rather than refused. Two people merging their halves of a file should
not have to resolve that by hand.

It is a **sequence** and not a map, although `graph.yaml` uses a map for exactly this
"named once" property. That decision is now the load-bearing one — see the last section: a
bare ref and a ref carrying markers are the same shape, which is what let cues arrive without
a migration.

## What the SET LIST is for: the machine must already have the songs

*(This section describes the playlist now. It stays here because the reasoning was worked out
for this file, and `mediatekSongRefs` still answers the question — just by reading the
surface and then the playlist, rather than reading this.)*

This is the part that is not obvious from the shape.

The machine that plays the set opens **file paths** — the engine cannot fetch a URL. So
every song in the set has to be on that machine's disk before you need it, and the venue
has no wifi. `mediatekPull` already answers "what does the open project reach for" for
modules, reading the refs **off the YAML before anything resolves them**, precisely because
a ref that resolves to nothing is the one worth fetching. `mediatekSongRefs` is the same
question for songs, and the pull syncs both families.

So the set list is a **cache manifest** that happens to also be the thing you look at. Any
shape that made that awkward — titles, a database, an order that mattered — would have
failed at the job it actually does. The playlist inherits that job whole; the one thing it
adds is that a line naming a song by its bare TITLE cannot be fetched, since resolving one
needs the catalogue this loop exists to populate. Such a line is skipped, and arrives at the
desk as a song the cache has not got — which is what it is.

Two consequences worth stating:

- A song ref syncs the **folder**, trailing slash and all (`songPathPrefix`), because a
  song IS its folder: the master, its variants, `song.yaml`. A sync that fetched only the
  file named would land a catalogued folder with nothing to play.
- The scope narrows **both sides** of the diff (`syncFamily`'s own note), so pulling one
  set's songs never evicts the rest of the cache. Adding a set to a machine is additive.

## The refs stay live

A ref names the médiathèque entry, and resolves at load, every load. Fix a song in the
médiathèque — a better master, a corrected title — and every set naming it is fixed, with
nothing to re-import. This is the same contract a module ref has, and it is why both are
refs rather than copies.

The cost is that a set is not a snapshot: what played last winter is not necessarily what
plays now. That is the right trade for a médiathèque that is curated rather than archival,
and the day it is not, the thing to add is a pinned revision beside the ref — not a copy of
the audio.

## A song the cache has not got is a state, not an error

`resolveSet` (in `@studio/ui-turntables`) keeps the ref whatever happens and reports `entry: null`. The sync
fetches what the open project names, so a set edited a minute ago is briefly ahead of the
disk — that is ordinary. It draws as a song that is **coming**, with its name taken from
the id's last segment.

Dropping it from the list would make a set that is missing three songs look exactly like a
set that never had them, on the one screen where that difference matters most.

## Une entrée peut porter des réglages — et c'est tout ce qui reste

Le jour annoncé plus haut est arrivé, et il n'a pas fallu transformer `songs:` en table. Une
entrée est **soit** une référence nue **soit** une référence qui porte quelque chose :

```yaml
songs:
  - "@st0/songs/artiste/album/titre"
  - ref: "@st0/songs/artiste/album/autre"
    markers: [ 12.5, null, 48.25 ]
```

Les deux formes coexistent exprès. Un morceau qui n'a rien à dire tient sur une ligne — donc
tous, tant que personne n'y a posé de repère — et toute liste écrite avant l'existence des
réglages se lit encore, sans migration. Une table de références vers presque-rien aurait donné
à chaque entrée l'air qu'il lui manque quelque chose, ce que cette page redoutait.

`markers` sont les huit repères du pupitre de m9, positionnels, en secondes dans le FICHIER :
[ui-turntables/docs/cues.md](../../ui-turntables/docs/cues.md). Le fichier est écrit par le pupitre, en
plein set, et `withMarkers` l'édite **dans son texte** — les commentaires de ce scaffold sont le
seul exemple travaillé qu'un lecteur obtient, et un pupitre qui les mangerait au premier repère
posé serait un pupitre qu'on ne pardonne pas.
