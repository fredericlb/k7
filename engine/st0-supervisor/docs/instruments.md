# instruments.md — the sampled instruments a machine downloads

The engine plays SFZ instruments (`engine/st0-engine/docs/sfzPlugin.md`) whose samples run from
8 MB to 750 MB. `src/Instruments.cpp` lists them and installs them under `<state>/instruments/<name>/`,
and a module names one as `@instruments/<name>/<file>.sfz`.

## The supervisor fetches them, when the engine starts

**Every instrument on the list, whether or not a song names one.** Fetching on first use would put
a download between opening a song and hearing it — minutes for the piano — and a machine that is
about to play a gig has to have everything before it leaves a network, not when a note asks.

**The supervisor, not a server.** The files come from their origin straight onto the machine that
plays them: through a server they would be stored once per account and copied again across the
tunnel to every engine. The supervisor already owns this machine's network and outlives every
session, which is what a download of that size needs.

They run after the engine is started, one at a time, on a thread of their own; the engine plays
while they run, and a song that names an instrument still missing loads it the moment it lands.

## Pinned by the archive's hash

Each entry is a URL and the SHA-256 of what it serves. An archive whose hash differs is **refused**,
never installed: an upstream that changed its file would otherwise change a song's sound under it.
The piano is a GitHub commit's zip, which cannot change; the No Budget Orchestra's and the clavinet
(Musical Artifacts) are plain files on a web server, which could, and would then fail loudly until
the list is updated.

## Installed only when whole

The archive is downloaded beside the folder (`<name>.zip.part`), unpacked into a sibling, renamed
into place, and the marker `.st0-archive` — the hash it came from — written last. `installed` reads
that marker: a download cut short leaves no marker and is started over at the next engine start,
and a list that pins a NEW archive replaces an older install. A name in the archive that would land
outside the folder is refused. One folder and nothing else at the top — what GitHub serves — is
dropped, so `<file>.sfz` sits directly under `<name>/`.

## What the tray shows

The snapshot carries `downloads`, absent when nothing is downloading (`docs/hostProtocol.md`), and
the tray draws ONE menu line from it: the first one's label and percentage, how many more wait, and
a failure that stays until the next start; and the icon keeps its spinner, not the green dot, until
none is left to fetch, since a song naming a missing one would play silent. A frame is emitted per
whole percent at most, since each one rebuilds the menu.

**The total is the pinned size**, never the server's: GitHub serves the piano chunked, with no
length, and the HTTP client's own "total" is then the current chunk's.
