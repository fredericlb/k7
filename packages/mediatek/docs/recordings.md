# recordings.ts — the recordings zone

Two languages live here: **storage** and **code** are English (`songs/`, `recordings/`, `addSong`),
the **prose** and the **interface** are French — the two tabs read « Morceaux » and
« Enregistrements » on screen.

## A root zone, not a family, not a *kind*

```
<root>/
  songs/        ← family: the songs, <artist>/<album>/<title>/, catalogued
  samples/      ← family
  modules/      ← family
  library/      ← zone: the assets a module names (ir/, nam/)
  recordings/   ← zone: the recordings, <YYYY-MM-DD>/<HH-MM-SS>.<ext>
```

**Not a fourth family.** `Family` is a type everyone consumes — the scan, the tokens, the manifest,
the desk, the cache. Adding one for something that produces no catalogue entry would cost a `switch`
everywhere, for empty branches.

**Not a subfolder of `songs/` either.** A recording has no title, no artist, no cover: it is a time
and some bytes. A thousand `21-05-07.mp3` files would drown three hundred songs in the list, and
search could do nothing with them — no field to query. The filing would then say the opposite of what
the screen shows: `recordings` is a **section**, level with the other three, and in a repository
where the filesystem *is* the catalogue, a section living inside another's folder is a lie that
eventually costs. Two chores vanish with the choice — no hole to dig in the family's manifest, no
token to borrow from it.

**This zone is what draws the line**, and that is why `songs/` has no provenance subfolder: filing
songs under `imported/` / `recorded/` would be a second, worse answer to the question this page
answers — what is catalogued, and what is raw ([songs.md](songs.md)). `library/` is the same thing, a
root folder that is not a family; the zone follows that precedent rather than inventing one.

So `scanFamily("songs")` does not see it and `/list?family=…` never mentions it — not an oversight,
and tested (`recordings.test.ts`, "what the zone is NOT").

## Outside the manifests, so outside the caches

`manifest()` takes a **family**. The zone is not one: no possible argument reaches it, so it does not
sync — structurally, and not through a filter someone could forget to maintain. A cache downloads
what a manifest lists; these files enter no catalogue, so mirroring them would fill every disk with
bytes no surface can name or play. The hosted volume keeps them, the machines do not pull them back.
Should a recording need to play from a deck, the path is to **promote** it to a song, not to widen
the manifest.

## The time comes from the caller, when it knows it

`POST /api/mediatek/recording?filename=…&at=<ISO>` — `at` is the moment of the **recording**, not of
the upload, and it is optional:

| caller | `at` | why |
|---|---|---|
| a recorder pushing live | absent | the server clock says the same thing |
| a batch pulled back the next day | supplied | otherwise the whole session lands under the wrong date |
| the médiathèque's button | the file's mtime | for a recording, that is its time |

An unreadable `at` is a **400**, not a silent fallback to now: a caller that took the trouble to send
one cares where the file lands, and today is the one answer it certainly did not want.

Day and time are **local**, not UTC. A rehearsal ending at 00:30 files under the day the person
playing would call "last night".

## Moments live in the same day folder

A moment is an excerpt cut out of a session: a time, a duration and sometimes a name. All three are
in the filename.

```
recordings/2026-08-03/21-05-07.webm                          ← the session
recordings/2026-08-03/moment-21-01-30--15--The solo.webm      ← an excerpt, named
recordings/2026-08-03/moment-21-01-30--15.webm               ← an excerpt, anonymous
```

The same folder as the recordings, not a subfolder: what was played that night is in one place.
But a moment's clip is **not a capture**, and `listRecordings` leaves it out (`isMomentClip`,
`src/recordingName.ts`). The moment is listed under the capture it was cut from, where it says what
it is (`packages/ui-library/docs/recordings.md`). Listed beside that capture, it would read as a
second, shorter recording of the same evening. A day holding only clips is not listed.

The time is when the excerpt was **played** — the session's start plus its offset — not when someone
annotated it, which may be three days later. The zone files by playing time; a moment is no
exception.

`--` separates the fields, so a name carrying its own run of dashes is reduced to a single one.
Nothing re-parses that name — the metadata stays with the caller — but someone reading
`moment-21-05-07--15--Solo` should not have to guess where the duration ends.

## Two files on the same second are not a conflict

The taken name wins a `-2`, `-3`… Two microphones stopping together is an ordinary afternoon, not an
error to report.

The opposite of `addSong`, which answers 409 when the deduced folder is occupied — and both are right,
because the duplicate does not mean the same thing: there, two uploads deducing one folder are almost
always **the same song** twice; here, two files on the same second are **two files**.

## The API is the main road

The route sits behind the same `bearerOrSession` as the rest of the library (see
`apps/k7/backend/src/server.ts`), so a recorder with no browser has nothing special to do: it
presents an API token — the one `POST /api/token` issues — and pushes raw bytes.

```bash
curl -X POST \
  -H "Authorization: Bearer $STUDIO_TOKEN" \
  -H "content-type: application/octet-stream" \
  --data-binary @take.mp3 \
  "https://app.priv.k7.rocks/api/mediatek/recording?filename=take.mp3&at=2026-08-03T21:05:07"
# → { "ok": true, "path": "recordings/2026-08-03/21-05-07.mp3", "day": "…", "name": "…" }
```

Raw body and not multipart, for the reason that already holds for `PUT /file`: an hour-long recording
must never become a field in a form parser.

The médiathèque's button sends exactly the same request, one per file. A partial upload is a real
result: the files that went through are in the zone, and the interface shows them despite the error
on the ones after.

## Its own token, on the same card

`revisions()` returns one token per family **plus the zone's**, and `/revision` serves them together:
one poll for four tabs, each reloading only when its own moved. Borrowing `songs`'s would reload an
identical song list on every recording. Same reason for `summary()` returning four numbers and not
three — otherwise the fourth tab shows zero until it is clicked.

## What the section shows

A tab beside the three families: a calendar and each day's captures at the time they started, with
the size and the moments cut from them, and nothing else, because a recording has no title, no
artist and no *kind* to show (`packages/ui-library/docs/recordings.md`). The start is read off the
name (`capturedAt`, `src/recordingName.ts`), which a browser parses the same way, so that module
imports nothing from Node.

Nothing in the section renames a recording: that would produce a file at a time it was not
recorded at. The same decision as for `songs/`, for a different reason, and in both cases the door is
a header button.
