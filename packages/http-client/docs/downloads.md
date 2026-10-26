# Downloads under way

`src/downloads.ts` is the page's one list of what is coming down: the médiathèque's and the songbook's
copies from the paired server, a model the file service fetches, an instrument the supervisor fetches.
The sidebar's download manager (`apps/k7/frontend/src/components/DownloadsButton.tsx`) draws it, and a
row that started a download reads its spinner from it.

## Choices

- **A module-level store, not React state.** The médiathèque, the songbook and k7's sidebar are three
  packages that cannot import each other; this package is the one all three already depend on. It stays
  framework-free: each screen reads it with `useSyncExternalStore`.
- **A key names the thing, not the click.** `library:<family path>`, `songbook:<id>`, `model:<job>`,
  `instrument:<name>`. Queuing a key already queued or running answers the same promise, so a second
  click, or an album's "download missing" over a song already coming down, fetches nothing twice.
- **The copies are queued one entry per song, two at a time.** The backend answers a copy only once it
  is whole and reports no progress, so a batch POST would be one spinner for an album and a count that
  jumps from 0 to N. One entry per song is what makes "done / total" mean something.
- **Two at a time** keeps the paired server and the disk from being asked for an album at once while
  a second song still overlaps the first one's round trips.
- **What others run is mirrored, not queued.** A model job runs on the file service and is polled
  (`trackDownload`); the supervisor keeps its own instrument queue and pushes it whole (`syncDownloads`,
  where a row that leaves the list while running has landed).
- **Finished rows linger four seconds once nothing runs**, then go; a failure stays until Clear, since
  it is the one row that asks for something.
