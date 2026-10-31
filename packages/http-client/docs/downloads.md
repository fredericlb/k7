# Downloads under way

`src/downloads.ts` is the page's one list of what is coming down: the médiathèque's copies from the
paired server, a model the file service fetches, an instrument the supervisor fetches.
The sidebar's download manager (`apps/k7/frontend/src/components/DownloadsButton.tsx`) draws it, and a
row that started a download reads its spinner from it.

## Choices

- **A module-level store, not React state.** The médiathèque and k7's sidebar are two packages that
  cannot import each other; this package is the one both already depend on. It stays
  framework-free: each screen reads it with `useSyncExternalStore`.
- **A key names the thing, not the click.** `library:<family path>`, `model:<job>`,
  `instrument:<name>`. Queuing a key already queued or running answers the same promise, so a second
  click, or an album's "download missing" over a song already coming down, fetches nothing twice.
- **The copies are queued one entry per song, two at a time.** The backend answers a copy only once it
  is whole and reports no progress, so a batch POST would be one spinner for an album and a count that
  jumps from 0 to N. One entry per song is what makes "done / total" mean something.
- **Two at a time** keeps the paired server and the disk from being asked for an album at once while
  a second song still overlaps the first one's round trips.
- **What others run is mirrored, not queued.** A model job runs on the file service and is polled
  (`trackDownload`); the supervisor keeps its own instrument queue and pushes it whole (`syncDownloads`,
  where a row that leaves the list while running has landed). The backend's update check of the
  songs that follow their server is mirrored the same way, under `songs-sync:` — the check as one row
  saying what it found, each song it brings down again as its own (`apps/k7/backend/docs/media/songUpdates.md`).
- **A finished mirrored row is handed over once.** A backend keeps an ended job listed a few seconds so
  a poll sees it end; the mirror then stops passing it, or the next poll would draw a row the manager
  had already let go of after its linger.
- **A song opened on the phone queues the same `library:<path>` as its download button**, so the
  background copy of a first look and a click on the button are one job.
- **A moment sent to a server to be consolidated is a row too** (`moment:<id>:<link>`), though it goes
  UP: it is the one long transfer a rehearsal page starts, and a second place to watch transfers
  would be a second place to look (`packages/ui-rehearsal/docs/recordings.md`).
- **Finished rows linger four seconds once nothing runs**, then go; a failure stays until Clear, since
  it is the one row that asks for something.
