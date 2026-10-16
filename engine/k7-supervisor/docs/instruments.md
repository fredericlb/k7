# instruments.md — the sampled instruments a machine downloads

The engine plays SFZ instruments (`engine/k7-runtime/docs/sfzPlugin.md`) whose samples run from
8 MB to 750 MB. `src/Instruments.cpp` lists them and installs them under `<state>/instruments/<name>/`,
and a module names one as `@instruments/<name>/<file>.sfz`.

## The machine keeps what its musician chose

**Nothing is downloaded until it is asked for**, on the desktop app's Engine page
(`apps/k7-standalone/docs/engine.md`), in the Downloads section of k7's settings inside the Android
app (`engine/k7-runtime/docs/android.md`), or in `instruments` in the command-line engine's config file —
`["all"]` keeps every one (`docs/supervisor.md`). The list runs to gigabytes — the piano alone is 750 MB, the drum
kits more — and a machine that never plays a piano should not pay for one. What is chosen is
remembered in `engine-host.json` as `instruments`, the names this machine keeps:

- **A kept instrument is fetched whenever it is missing**: at each supervisor start, and again
  when the list pins a newer archive, so a machine that leaves a network has what it chose.
- **Absent is not empty.** A home that has never chosen is settled on its first boot to the
  instruments already installed there, so an update keeps what an older supervisor fetched and
  downloads nothing new. An empty list is a choice to keep nothing, and stays one.
- **`STUDIO_INSTRUMENTS=all` keeps them all** and outranks the setting, for a host with nowhere to
  choose. No app sets it: each has a Downloads section, and a phone is the host that can least
  afford gigabytes it did not ask for, often over a metered network.

**One at a time, in the order asked.** The queue runs on a thread of its own; the engine plays
while it runs, and a song that names an instrument still missing loads it the moment it lands.
A queued one can be cancelled. A running one cannot — the worker would write into a folder being
deleted — and the supervisor refuses the removal with a reason rather than guessing.

**Remove deletes the marker first**, then the folder and whatever a cut-short install left
beside it, so a removal that stops halfway reads as not installed, never as a whole instrument.
An engine still playing it keeps what it already loaded until its next load.

**k7 asks the ENGINE, not the supervisor**, whether an instrument is here
(`engine/k7-runtime/docs/protocol.md`, `instrument-status`): the engine is the one a browser
already talks to, and the files are where the engine reads them.

**The supervisor, not a server.** The files come from their origin straight onto the machine that
plays them: through a server they would be stored once per account and copied again across the
tunnel to every engine. The supervisor already owns this machine's network and outlives every
session, which is what a download of that size needs.

## Pinned by the archive's hash

Each entry is a URL and the SHA-256 of what it serves. An archive whose hash differs is **refused**,
never installed: an upstream that changed its file would otherwise change a song's sound under it.
The piano is a GitHub commit's zip, which cannot change; the No Budget Orchestra's and the clavinet
(Musical Artifacts) are plain files on a web server, which could, and would then fail loudly until
the list is updated.

## Installed only when whole

The archive is downloaded beside the folder (`<name>.zip.part`), unpacked into a sibling, renamed
into place, and the marker `.k7-archive` — the hash it came from — written last. `installed` reads
that marker: a download cut short leaves no marker, only its `.part`, and is taken up again at the
next supervisor start; a list that pins a NEW archive replaces an older install. A name in the
archive that would land outside the folder is refused. One folder and nothing else at the top — what
GitHub serves — is dropped, so `<file>.sfz` sits directly under `<name>/`.

## A cut download is resumed, and the hash still judges the whole

The largest archive is over a gigabyte, and the machine that fetches it is often a phone, killed in
the background or moved between networks. Started over each time, it might never land. So a `.part`
left behind is RESUMED: `http::download` asks for the bytes past its length with a `Range` header.

- **206 starting at that length** — the answer is appended to the `.part`.
- **200** — the server cannot resume (GitHub's generated zips, the piano among them), and the
  answer replaces the `.part` whole.
- **416 naming the `.part`'s own length as the size** — it is already whole: nothing is fetched,
  and the hash decides.
- **416 otherwise, or a 206 starting elsewhere** — what is there is no prefix to trust: dropped, and
  the download starts from zero in the same call.

The answer goes to a file beside the `.part` until its status says which of these it is, since the
HTTP client hands over the body before it hands over the status. A transfer cut short keeps what it
brought, and an error page never lands in the `.part`.

Nothing in a resume is trusted beyond what the hash proves: the WHOLE `.part` is hashed before it is
unpacked, as it would be after one uninterrupted download. A resumed archive that does not match is
deleted and the error says the next try downloads it whole, since a mismatch there can be a bad
prefix rather than an upstream change. A verified archive that fails to unpack is kept, so the next
try finds it whole and fetches nothing.

## What an app shows

The snapshot carries `instruments`, every row of the Downloads tab, and `downloads`, absent when
nothing is queued or fetching (`docs/hostProtocol.md`). An app draws ONE status line from the
latter: the first one's label and percentage, how many more wait, and a failure that stays until
it is retried or the next start; and its status keeps a spinner, not the green dot, until
none is left to fetch, since a song naming a missing one would play silent. A frame is emitted per
whole percent at most, since each one redraws the line.

**The total is the pinned size**, never the server's: GitHub serves the piano chunked, with no
length, and the HTTP client's own "total" is then the current chunk's.
