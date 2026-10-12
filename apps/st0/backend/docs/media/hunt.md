# Finding songs — from what you type to a filed file

"Find songs" is an entry of its own in st0's home sidebar, beside the library's sections, and opens
**a page** (`/media/find`): a search field at the top, and below it the history of what has already
been asked for. The screen is `packages/ui-library/docs/hunt.md`; this page is the server's half. You type
"nirvana lithium", and the whole chain unrolls by itself:

```
  what you type
        │
        ▼
  MusicBrainz  ──►  artist / title / album      (NAME it before searching)
        │
        ▼
  slskd (another machine, REST)  ──►  "album title", then "title" — never the artist
        │
        ▼
  filter: same artist, same title, a format the médiathèque can file
  sort: quality, then who will actually send
        │
        ▼
  queue at the best peer — 60 s to start, otherwise the next
        │
        ▼
  SFTP: the backend fetches the bytes from the slskd machine
        │
        ▼
  addSong  ──►  songs/<Artiste>/<Album>/<Titre>/original.<ext>
```

## Name it before searching

MusicBrainz goes **first**, and that is not decoration. The folder's name is derived from the tags
(`songFolder`), so the tags are not a label: they are the path. Searching Soulseek first and reading
the received file's tags would let a stranger name a folder of the médiathèque — and half the files
on the network are tagged `Track 05` or not tagged at all.

It is also what gives the filter a **canonical** artist and title to compare against, instead of the
string that was typed.

### Two measured, counter-intuitive facts

**MusicBrainz's `score` is anti-correlated here.** For "nirvana lithium", Nirvana's actual recording
comes back with a score of **38**, while recordings merely *titled* `Lithium(nirvana)` score **100**.
That score answers "does this document match the Lucene query", which is not the question being
asked. So it is **not** used as a filter: any threshold would throw away the right answer. This is
verified, not assumed — do not "fix" it.

**A full-text search is not enough.** For "miles davis so what", the first hundred answers contain
**no** Miles Davis recording of So What: the ranking is carried off by entries whose title contains
all four words. We do not know which words name the artist, so `buildQuery` asks for **every split
at once**, in a single request:

```
(artist:"miles" AND recording:"davis so what") OR
(artist:"miles davis" AND recording:"so what") OR
(artist:"miles davis so" AND recording:"what")
```

Lucene scores whichever clause matches. Useful side effect: the query is assembled from words passed
through `normalise`, so only `a-z`, `0-9` and spaces reach Lucene — a quote typed into the field is a
word separator, never an operator.

If no split returns anything, it falls back to full text. A second more costs less than a dead
search.

### The bootleg trap

A well-known song comes back as **a hundred different recordings** — one per concert — each carrying
only the release it appeared on. Taken one by one, the answer is the first live going, and *Lithium*
would be filed under "1991-10-21: Live in Austin, Texas". A folder nobody finds again.

So `chooseTags` pools the releases of **all** the tied recordings, and `pickAlbum` chooses on three
criteria, in this order:

| criterion | what it rules out |
|---|---|
| the **type** (`releaseScore`) | live, bootleg, compilation, remix — penalised, not excluded |
| **recurrence** | an outtakes compilation is typed *exactly* like a studio album; what separates them is that the real record comes back on every recording and the curiosity only once |
| the **date**, last | it cannot be first: the *Nevermind* rows MusicBrainz returns for Lithium are all 2021 reissues, so "the oldest" would give the 1996 compilation |

Penalise rather than exclude, because a song whose studio album nobody catalogued deserves better
than "Album inconnu": the live it really appeared on.

The release **kept** within the winning group is the oldest, so the date shown is the record's and
not a reissue's.

### When MusicBrainz cannot be reached

`identify()` (`hunt.ts`) tries MusicBrainz first and only calls `lookupDeezer()`
(`deezer.ts`) when that call **throws** — a network refusal, a timeout, a block. A legitimate
`null` (MusicBrainz answered and found nothing) is never a reason to ask Deezer: a real
no-match is information, not an outage.

Deezer is the fallback and not the default because it is weaker on the two things that matter
here: it carries no release-type signal, so `pickAlbum`'s bootleg-trap scoring has nothing to
work with, and no date without a second call per candidate, which a fallback path does not
spend. `chooseTagsDeezer` picks the best textual match (`queryScore`, the same scorer
MusicBrainz results use) and breaks a tie with Deezer's own `rank` field — a popularity proxy,
the nearest stand-in available for what `releaseScore` does with real release types.

### A caller can check the name before anything downloads

`GET /api/hunt/identify?q=` answers what a query WOULD hunt (`HuntIdentity`,
`packages/web-protocol/hunt.ts`) and downloads nothing, and `POST /api/hunt` takes those `tags`
back: a hunt given tags files them as given and never identifies again. The scoring picks the
recording that best explains the WORDS typed, which is not always the song meant — one word landing
on a band's name (« Expedition 33 Lumières » is the band Lumières' « Momentary ») outscores a title
that is spelt differently. A caller who knows the song (the rehearsal songbook) checks the answer first, and a
second identification between the check and the hunt could answer otherwise.

## What slskd is asked: the album and the title, never the artist

Two attempts, in this order (`searchTexts`):

| # | the query | why |
|---|---|---|
| 1 | `Nevermind Lithium` | the album is the precise half of the pair |
| 2 | `Lithium` | what is left when nobody files by album |

**The artist is never in it.** A Soulseek search runs over the whole shared path, and the artist is
almost always the folder *above* the album: it restricts nothing the album has not already
restricted, and every added term is one more way for a legitimate copy to be missed.

It has not disappeared, though — it is the **filter** on what comes back. That is the whole shape of
this step: **ask broadly, judge strictly.** A term in the query can only lose results; a term in the
filter applies to what peers actually sent, and can therefore be demanding at no cost.

Accepted price: someone sharing `…/Nevermind/05 Lithium.flac` with no artist folder above is found
by the search and then **dropped by the filter**. The case is a minority, Soulseek paths being
overwhelmingly `Artist/Album/Track`.

With no album, there is a single attempt: firing the bare title twice would only spend a second
round of somebody's patience. And the ten-peer budget is **global across both searches**, not ten
per attempt — otherwise the fallback quietly doubles the worst case to twenty minutes. A peer
already tried is skipped rather than requeued: the two searches overlap heavily, and giving another
minute to the same motionless queue is what switching peers exists to avoid.

## Choosing a peer

`rank.ts` is pure and tested, because it is what decides what enters the library.

**Filter.** Same artist (looked for anywhere in the path, where it is nearly always a parent folder)
and same title (looked for in the **filename** only — the album folder names eleven other songs). By
whole words and not by substring: `includes("air")` would give a search for *Air* every file by
*Airbourne*.

And above all: the format must pass `isAudio`, **the médiathèque's own gate**. `.ape` is everywhere
on Soulseek and `masterName` refuses it — downloading it would be an hour of transfer for a file
that cannot be filed. One rule, at both ends.

**A live or bootleg copy is excluded outright**, not scored down: `isLiveOrBootleg` tests the
whole path for "live" or "bootleg" as a whole word, so a `…/Live/05 Lithium.flac` folder or a
`Lithium (Live at Reading).mp3` file name never reaches the quality sort even when it is the only
answer a search gets. Filed under the wrong tags this is a naming mistake `pickAlbum` fixes on the
next search; filed as the wrong RECORDING it is forty megabytes nobody asked for, sitting in the
médiathèque under a studio song's name — the costlier error, so it is excluded rather than merely
outranked.

**Sort.** Quality first, as asked: flac, then wav/aiff, then 320, 256, 192, below. When the peer does
not state its bitrate — the field is optional in the protocol and many clients omit it — it is
**measured** on the bytes, size over duration. A file nothing can be said about ranks *below* every
known bitrate, or it would win by being silent.

**Availability breaks ties at equal quality**, and that is not a refinement: a download is abandoned
after sixty seconds, so a peer with three hundred people in its queue is worth nothing however good
its copy. Two files at the same tier are the same file; all that is left to choose is who will send
it.

**One entry per peer.** That is the list peer-switching operates on: a peer sharing a discography
would otherwise fill the first ten places alone, and the ten switches would fall back on the same
motionless queue.

At equal quality and availability, the **peer's name** breaks the tie, as a last resort. An unstable
sort would make two identical searches differ, and so a failure impossible to reproduce.

### Comparing two spellings of one name

A Soulseek path is what the sharer typed — `AC-DC`, `AC_DC`, `ac dc` — while MusicBrainz says
`AC/DC`. `normalise` brings them all to `ac dc`: accents decomposed then dropped, lowercased, and
anything neither `a-z` nor `0-9` turned into a space. That is the only level at which the two
compare.

On top, `tokens` removes words carrying no identity (`the`, `a`, `le`, `los`…): half of Soulseek
files the Beatles under `Beatles` and the other half under `The Beatles`. An artist made **entirely**
of those words — "The The" — would leave nothing to test, and `every` on an empty list is true: that
case falls back to a substring comparison, which accepts the band instead of accepting the whole
network.

The accepted price of whole-word comparison: a run-together spelling (`acdc`) is missed. It is the
cheaper of the two errors — a search that finds nothing says so, a search that files the wrong band
does not, and the same trade is why the title filter is whole-word too.

### A transfer's state is a flag set, not a value

What slskd puts on the wire is a comma-joined flags enum: `"Completed, Succeeded"`,
`"Queued, Remotely"`. So `classify` looks for **substrings** and never equality: the exact spelling
belongs to Soulseek.NET, and a `switch` on literals would silently class a renamed flag as "still
queued" — sixty seconds of waiting for nothing.

`Initializing` counts as **started**: the peer has answered and the two are negotiating, which is
exactly what the sixty-second rule is waiting to see.

Same caution on SHAPE: slskd nests transfers under directories, and `flattenTransfers` walks what
comes back looking for objects carrying a `filename` and a `state`, at any depth. A client that
hard-coded a path into that nesting would answer "no transfers" the day it changes — which reads
exactly like a download that never started, and would burn all ten peer switches.

## Sixty seconds, ten peers

Exact reading: the counter goes up one each time a peer is abandoned, and reaching ten stops the
search — **ten peers tried**, the tenth abandonment being the failure.

A peer that **refuses** (error, rejection, cancellation) does not wait out the minute: it has already
answered. Likewise, a transfer that *disappears* from slskd's list after having been in it is an
abandonment on its part, not a queue — treating it as "still waiting" would burn the minute on an
answer already given.

Once the transfer has **started**, it gets thirty minutes. That ceiling is not in the request, but a
peer that sends two kilobytes and then sulks would otherwise leave a blue line spinning for ever.

### Releasing a search: stop before deleting

A search **outlives the interest taken in it**: what has arrived is ranked after a few seconds, while
Soulseek goes on answering for half a minute.

Deleting a search still in flight therefore makes slskd throw, since it updates that search's row as
answers come in:

```
Failed to execute search for 'Lady Gaga Telephone':
The database operation was expected to affect 1 row(s), but actually affected 0 row(s)
```

The `UPDATE` targets a row deleted from under it. So `releaseSearch` does things in order:
`PUT /searches/{id}` **stops** the search — that is what the verb does at slskd — then the `DELETE`
waits until it is no longer running.

And if it never ends, **the row is left**. One extra row in slskd's list costs nothing; a stack trace
in the logs on every search costs the trust placed in the tool. For the same reason the function
never throws and is not awaited: it is tidying, not the search's result.

## The bytes: slskd cannot serve them

Verified in slskd's source, and it is what decides the whole architecture: its `FilesController`
exposes `GET` to **list** the download directories and `DELETE` to remove — **no route returns a
file's content**.

So the backend cannot retrieve the file through the API. It fetches it over **SFTP**, and it is the backend pulling
rather than the slskd machine pushing. Intended consequences: no script to run over there (so no
hostile data handed to a remote shell), the backend does not need to be reachable from that machine, and it
remains the only requester — as on the control plane.

A **client** and not a mount: no FUSE, so no `CAP_SYS_ADMIN` on the container holding everyone's
files; no mount to re-establish after a restart; no blocking call able to freeze the event loop; and
the same code in dev on Windows as in production on Linux. Above all: a mount would be **two**
mechanisms to keep working instead of one.

`localPathFor` reconstructs the layout slskd documents: `<downloads>/<dossier>/<fichier>`. If the
file is not there — slskd is configurable — it is looked for by name across three levels, because a
failure due to *that* would be indistinguishable from a song nobody shares. Three levels and no
more: beyond that it is not a recovery, it is a directory walk.

`exists` **throws as readily as it answers `false`** — missing folder, missing permissions — and both
say the same thing here: not where it was expected. One connection per fetch, never a pool: a hunt
goes for a file once, minutes after the previous one, and the close is in a `finally` — otherwise
every failed hunt would leave a session open on the other machine until its own timeout.

The 512 MB ceiling is the médiathèque's own upload route's: beyond that it would be an hour of
transfer for a file `PUT /file` would then refuse to file.

### This step tells its story in the logs

This is where two machines meet, so this is where nothing can be deduced after the fact. Every fetch
writes what it is aiming at and what it sees:

```
⇣ sftp → fred@slskd.lan:22 (clé)
⇣ sftp connecté, dossier /downloads
⇣ sftp nom chez le pair : @ann\Music\Nirvana\Nevermind\05 Lithium.flac
⇣ sftp chemin visé      : /downloads/Nevermind/05 Lithium.flac
⇣ sftp /downloads : 3 entrée(s) → [d] complete, [d] incomplete, [-] readme.txt
⇣ sftp pas à l'endroit attendu (absent) — recherche par nom sur 3 niveaux
⇣ sftp descente dans /downloads/complete
⇣ sftp /downloads/complete : 1 entrée(s) → [d] Nevermind
⇣ sftp trouvé ailleurs  : /downloads/complete/Nevermind/05 Lithium.flac
⇣ sftp 40.1 Mo lus depuis /downloads/complete/Nevermind/05 Lithium.flac
```

What that trace gives, and no error message would: **the peer's name and the deduced path side by
side**, so an unexpected slskd layout reads at a glance; and the folder's **actual contents**, so
"wrong download folder in the settings", "the SSH user lacks permissions" and "slskd wrote nothing" stop
looking alike.

The first line is written **before** connecting: if that is what fails, those are the values you
want to re-read, and `connect`'s exception does not carry them. It says there is a key, never which
one — a test checks that. Always written, not only on failure: a download takes minutes, so a dozen
lines is not noise. Listings are cut at forty entries, a download folder holding thousands.

## What comes from the network is hostile

slskd's own documentation says so: filenames come from the Soulseek network and can contain
anything. They pass through two places here, and each has its defence:

1. **The remote path** → `localPathFor` strips `.` and `..` segments before keeping the last two, so
   the result is **always** under the download folder. A test checks it on three escape forms.
2. **The filed file's name** → it only supplies the master's extension, via `masterName`, which
   refuses anything the scan would not see as audio. The folder comes from the MusicBrainz tags
   passed through `segment`, which drops anything unnameable and cuts at 80 characters. `putFile`
   refuses a `..` on top of that, and `writablePath` a leading `.` segment.

Nothing a stranger typed becomes a path.

## The hunt does not target a playlist

Not even this volume's own, under `playlists/` ([playlists.md](../../../../../packages/ui-library/docs/playlists.md)). A hunt **files a song**
and stops there, because what it produces is bytes and what a set list holds is a name — and the two
are not one gesture: a download that also wrote into a document would decide, on your behalf and
while you were not looking, which set list a song belongs to.

And it can never target a workspace's `_playlists/`, which is a stronger statement than a preference:
those live in the account's workspace, which only its file service writes ([projects.md](projects.md)),
and the backend that mints everyone's session must not additionally be able to write into
everyone's repository. A "just one line of YAML" costing that property is expensive.

So the division is this: **the hunt files the song into the médiathèque**, and adding it to a set list
is one click afterwards — on the library's Playlists page, whose search reads the same catalogue the hunt
just wrote into, or in the editor's own playlist screen, which queries the same catalogue
(`apps/st0/frontend/docs/playlists.md`). Eight searches in a row therefore cost eight clicks, in a
screen that shows the set list while you fill it.

## The fallback: "DL sur YouTube"

When Soulseek has been **asked and exhausted**, the row carries a **DL sur YouTube** button, which
retries the song with `yt-dlp`.

### Exhausted, not merely red

The button does not appear on every red line, and the distinction is the heart of the matter. Only
two failures say anything about the song's **availability**:

| the failure | the button |
|---|---|
| nobody shares this song in a usable format | **yes** |
| peers had it, none started sending | **yes** |
| service restarted, search cancelled | no — Soulseek said nothing |
| slskd not configured, MusicBrainz recognised nothing | no — we did not even search |
| downloaded, but not findable over SFTP | no — and especially not |

That last row is the one that counts: the file **was** downloaded, it is the retrieval that failed.
Offering YouTube there would hide a configuration fault behind a lower-quality file — the kind of
fallback that stops the real fault being fixed.

It is carried by `exhausted` on the row, set by the runner at the one place that knows, and from the
error's **type** rather than its text: an `includes("aucun pair")` would eventually recognise nothing
after a rewording, so would never offer the fallback again, with nothing to signal it.

The rule lives in the shared contract (`canFallBackToYoutube`), and **the route applies it too**: a
visible button the route would refuse is a dead end, and the inverse is a back door.

**A button, never an automatic fallback.** It is a different bargain: a compressed stream pulled from
a video instead of somebody's file. Knowing which song deserves that is a judgement about the song —
a cover for a rehearsal playlist, yes; a mix reference, certainly not — and a server has no business
making it for you.

It is **the same row** that restarts, not a new one. It already carries the tags MusicBrainz
resolved, so the song files exactly where it would have gone; and the history keeps one row per song
wanted rather than one per attempt, which is the question you ask rereading the list. The sidecar
says `source: youtube`, beside `slskd` and `upload`: once the folder is filed, that is the only trace
that you are listening to a video's audio track and not a record.

### Here the artist IS in the query

The exact opposite of slskd. A YouTube video title is written "Artist - Title", so the artist is in
the very field being queried; at Soulseek it is the folder above and restricts nothing. Same
information, two different places, two opposite decisions.

`ytsearch1:` turns the phrase into a video without our querying YouTube ourselves. One result only:
the second is already a cover or a live.

### Nothing is re-encoded

`--audio-format best` does not convert, it **keeps**: YouTube serves Opus around 130 kbps, and putting
that through mp3 would be a lossy-to-lossy transcode — distinctly worse than either, for nothing. So
what comes out is `.opus` or `.m4a`, which `AUDIO_EXT` already accepts. If yt-dlp returns anything
else, it is refused out loud rather than filing a file `masterName` would reject anyway.

### What is hostile here is the query

It comes from what someone typed, and it goes into a process. `ytdlpArgs` returns an **array**, and
`execFile` is called **with no shell**: a `;`, a `$(…)` or a quote in the search stays characters in a
search. Same discipline as for the Soulseek filenames, at the other end of the chain.

The work happens under `.hunts/tmp/<id>` — on the volume, so real space, and behind a dot, so
invisible to scans. Erased whatever happens: a failed download would otherwise leave bytes nothing
names.

### What it asks of the image

`yt-dlp` **and** `ffmpeg`, both in the Dockerfile. ffmpeg is not an extra: yt-dlp does not embed one
and cannot separate a stream from its container without it, so the two are one feature.

And it has to be known: **yt-dlp is a moving target**. YouTube breaks it every few months, so the
version frozen into an image ages and eventually fails; rebuilding is the fix. That is the cost of
this way out, and the reason it is a way out rather than the main path.

The screen asks the backend whether the binary is there (`GET /api/hunt` → `youtube`), probed once.
Without it the button is greyed and says so, rather than failing on click.

## The history

One row per search, most recent first, in `.hunts/<slug>-<hash>.json` on the volume — a dot folder, so
invisible to family scans and to the file API, exactly like `.prefs` and `.projects`. A hundred rows
kept: it is a memory for recognising what has already been asked for, not an archive, and the file is
read whole on every query.

Three colours for four states, because "searching" and "downloading" are both "in progress" to
whoever is watching. The detail shown changes with the state: while downloading it is **who** is
sending and which peer number, on failure it is **why**, once filed it is **where** — and the format
obtained, said plainly, so a 128 kbps is not taken for a mix reference six months later.

A search lives in a process's memory. A redeploy loses it while its row still says "in progress" — a
blue line spinning for ever. `reconcile` marks as failed anything in a live state that no runner
claims, at the next read, which is also the first moment anyone could have noticed.

## Guard rails

Four simultaneous searches per person, maximum. A search occupies a slot in a peer's queue for ten
minutes; forty at once would be a good way to get the account banned. MusicBrainz is limited to
**one request per second**, queued rather than rejected — two people searching at once is normal.

The route is **session-only**, unlike the médiathèque and the projects which accept a machine token:
this one spends an account's bandwidth and reputation on a third-party network, which is not
something a service token should be able to trigger.

A song already in the médiathèque is recognised **before** the download. `addSong` would refuse it at
the end anyway, and learning that after forty megabytes is a worse way to learn it.

The sidecar carries `source: slskd`, beside `upload` and `k7` (the rehearsal recorder's) — the field exists precisely to tell
whoever reads the folder where it came from.

## Configuration

The slskd address, its API key and the SFTP access are the **instance's**, typed on the settings
page and stored sealed on the volume — [settings.md](settings.md). None of them is an environment
variable.

| variable | what it is |
|---|---|
| `MUSICBRAINZ_USER_AGENT` | their terms require a client that names itself and says how to reach it |

While the settings are incomplete, the screen opens and **says what is missing**, with a button to
the settings page, instead of failing on every keystroke: a new instance is unconfigured.

## Why a row's error is a chain, not a message

A row that failed shows `Error.message` alone would say "fetch failed" for every network-level
break — slskd unreachable, DNS down, a timeout — since that is Node's own wording for the class,
not the instance. The real reason lives in `.cause`, so `message()` walks it and joins every
link (`fetch failed (ECONNREFUSED) ← connect ECONNREFUSED 10.0.0.5:5030`), the same flattening
`packages/mediatek/src/remote.ts`'s `why()` does for a download's own failures.

## What is not done

- The song is fetched **alone**. Taking the whole album would mean choosing between editions and
  track orders, which is another screen.
- No resume after a restart: an interrupted search is marked failed and relaunched by hand. Resuming
  would mean recovering a transfer's state at a peer, which slskd does not guarantee after a break.
- Nothing is **shared** back. Many peers automatically ban anyone who shares nothing, so the harvest
  will be poorer than with a client that shares — a decision to be taken, not an oversight.
- The YouTube fallback does not **choose** the video: it is the first answer, full stop. Offering a
  list would be another screen, and the first result of an "artist title" query is the right track
  far more often than it is for a Soulseek search.
