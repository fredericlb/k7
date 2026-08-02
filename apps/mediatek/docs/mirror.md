# Mirroring radiok7

The plan's étape 8 opens with this: *"Miroir radiok7 (tirage unidirectionnel depuis Grist,
chaque entrée portant sa clé amont, donc idempotent)"*. Three constraints in one sentence,
and each one decided something here.

## What gets mirrored, and why not the rest

radiok7 holds sessions, takes, moments and **releases**. Only releases are pulled, one
folder per **version**.

A session recording is a rehearsal — hours of a room, most of it not music. A release
version is a mixdown somebody decided was finished. The médiathèque catalogues *morceaux*,
and `morceaux/recorded/` means "what we made", not "what the microphone heard".

Every version, not just the release's default one. "Default" is radiok7's UI picking what
to play first; mirroring only it would silently drop takes the band deliberately kept. The
sidecar records `default: true` so a consumer can still prefer one.

## Unidirectional, and Grist stays the truth

Nothing here writes back. Grist remains radiok7's source of truth for as long as radiok7
uses it — that is what the plan's tension #1 said would remain true after the médiathèque
became hosted, and it still is.

The consequence worth stating: **the mirrored copy is not editable**. The sidecar says so
in its own first two lines, because the file is the only place someone about to edit it
will look. The next pull overwrites it.

## Idempotence: found by key, not by path

Every mirrored folder carries `grist: "version:<uid>"` in its `morceau.yaml`. The scan
already reads that field — `scan.ts` describes it as *"the upstream key of a mirrored
entry; its ABSENCE is what says mediatek-native"* — so the shape was waiting.

The mirror builds its index by **reading those sidecars**, not by computing where a folder
ought to be. That matters for a case that will happen: somebody renames a folder by hand.
Path-based matching would create a duplicate beside it on every single run, for ever. A
test pins it.

### Bytes are immutable, metadata is not

radiok7 never replaces a version's audio — a new mix is a new version — but a release's
title and artist are edited freely. So a folder that already exists gets its **sidecar
refreshed** and its audio left alone. That asymmetry is what makes a second run cost one
Grist listing instead of a whole library download, which is what makes the thing schedulable
at all.

### Folders are never renamed

A retitled release keeps its original folder name; only the sidecar's `title` moves.

This looks like sloppiness and is not. The path **is** the catalogue entry's `id`, and it is
a cache's manifest key. Renaming it makes every machine's `diff()` report the old path as
dropped and the new one as missing — a full re-download of bytes that did not change, on
every cache, for a cosmetic gain. The catalogue shows the sidecar's title anyway, so the
folder name is a label, not the name anyone reads.

## Partial results are real results

`added` / `updated` / `unchanged` / `failed` / `skipped`, and a failure of one version does
not stop the walk. Two specific behaviours behind those counters:

* A version row with **no attachment** is `skipped`, not mirrored. That is a real upstream
  state — an upload that failed halfway. As a folder it would read as a recording the
  library *has* and cannot play, which is worse than an absence.
* A download that fails **removes the folder it created**. Left behind, it would be an
  uncatalogued husk the next run does not recognise as its own, and which the scan lists as
  a morceau with no master.

The audio is written to `.part` and renamed, and the sidecar is written **last** — so a
crash mid-pull leaves an uncatalogued folder rather than a catalogue entry pointing at a
truncated file.

## Configuration, and why the names are its own

`RADIOK7_GRIST_API_URL`, `RADIOK7_GRIST_DOC_ID`, `RADIOK7_GRIST_API_KEY` — deliberately not
the `GRIST_*` names radiok7's own backend uses. This is a different service reading somebody
else's document; sharing the variable would make "which document" depend on which container
you happened to be looking at.

`POST /api/mirror/radiok7?owner=<id>` triggers it, **session-only** — unlike the library
routes, which also accept a bearer token. A token exists so a headless cache can *read*;
widening it here would let a leaked one repopulate a library from a Grist document its owner
never chose. `owner` scopes the pull, because pulling every band's recordings into one
library because a parameter was forgotten is easier to prevent than to undo.

## Not done, and knowingly

* **No scheduling.** A timer needs an answer to "what if it is halfway through when someone
  opens the library", and nothing wants one yet. Running it twice is the cheap case by
  design, so a human clicking twice costs nothing.
* **Deletions do not propagate.** A release removed upstream leaves its mirrored folder in
  place. That is the safe direction for a first cut — an upstream delete is not obviously a
  library delete — but it does mean the mirror only ever grows. The key is in the sidecar,
  so a reaper that drops folders whose key is gone upstream is a small function when it is
  wanted; the decision it needs is whether the library is a mirror or an archive, and that
  is not this file's to make.
* **Stems are not pulled.** A version can carry per-track stems (`TrackMeta`); only the
  mixdown comes across. A morceau folder holds one master, and multitracks are a different
  shape the library has no home for yet.
* **Never run against a real Grist document.** Every test here drives a fake. The wiring —
  env names, `listRecords` filters, attachment ids — is the part that has not been proved.
