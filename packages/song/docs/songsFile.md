# songs.yaml — the set list, and what it is really for

```yaml
songs:
  - "@mediatek/songs/lemo/mante/danse"
  - "@mediatek/songs/lemo/mante/aube"
```

The only file an m9 set has that a song has no counterpart for, and the only place a
project names the médiathèque's **songs** rather than its modules.

## A ref is `@mediatek/` plus the médiathèque id, verbatim

A `MediatekEntry.id` is the entry's library-relative POSIX path, and the catalogue's own
note says nothing else survives a rescan — there is no rowid, because there is no database.
A ref that **is** the id needs nothing resolved to be compared, deduplicated, sorted or
fetched: resolution is a map lookup, not a computation, and a ref that resolves to nothing
is still a perfectly good name for the thing to go and fetch.

Not a path, for the reason `modules_from` is gone: `project.yaml` is committed, and an
absolute path breaks on the next machine. Not a title either — two songs share one.

The refs must be **quoted**. `@` is a reserved indicator in YAML, so a plain scalar may not
open with one. `chainsFile.md` has the same note for module refs, and for the same reason.

### Why it looks a segment longer than a module ref

`@mediatek/audio/reverb` means `modules/audio/reverb` — the module vocabulary predates the
médiathèque having families, and omits its own. A song ref carries `songs/` because it is
the id.

The two are not made consistent. Rewriting every song already written would cost more than
the asymmetry, and the two are read by different files with different functions
(`mediatekRefs` against `mediatekSongRefs`), each mapping to its own path prefix. Nothing
has to tell them apart at a distance, which is what would make the inconsistency expensive.

## Unordered

The list is a **set**, not a running order. It is sorted on read — in `songRefs`, once, not
in each surface — so two screens cannot draw one set in two orders, and the file's line
order means nothing.

That is a decision about what a set list is: which songs you brought, not which order you
will play them in. The order is decided at the desk, and putting it in git would mean
either lying about it or committing during a gig.

Duplicates are dropped rather than refused. Two people merging their halves of a set list
should not have to resolve that by hand.

It is a **sequence** and not a map, although `chains.yaml` uses a map for exactly this
"named once" property. Nothing hangs off a ref yet, and a map of refs to nulls reads as
though something were missing. The day a song carries a set-local setting — a cue point, a
trim — this becomes a map, and that migration is mechanical.

## What the file is FOR: the machine must already have the songs

This is the part that is not obvious from the shape.

The machine that plays the set opens **file paths** — the engine cannot fetch a URL. So
every song in the set has to be on that machine's disk before you need it, and the venue
has no wifi. `mediatekPull` already answers "what does the open project reach for" for
modules, reading the refs **off the YAML before anything resolves them**, precisely because
a ref that resolves to nothing is the one worth fetching. `mediatekSongRefs` is the same
question for songs, and the pull now syncs both families.

So the file is a **cache manifest** that happens to also be the thing you look at. Any
shape that made that awkward — titles, a database, an order that mattered — would have
failed at the job the file actually does.

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

`resolveSet` (in m9) keeps the ref whatever happens and reports `entry: null`. The sync
fetches what the open project names, so a set edited a minute ago is briefly ahead of the
disk — that is ordinary. It draws as a song that is **coming**, with its name taken from
the id's last segment.

Dropping it from the list would make a set that is missing three songs look exactly like a
set that never had them, on the one screen where that difference matters most.
