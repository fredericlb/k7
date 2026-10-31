# Where an opened song is read and written

A song page reads its tags, texts, sheets, waveform and audio, and writes its tags, texts, sheets and
variants. `src/songSource.ts` decides through which library client each goes, and the page's parts
read that `SongSource` from context instead of the global `library`. `src/useOpenSong.ts` builds it
for the song the address names.

## On the phone, a server song is the server's

The phone's own médiathèque is small and its server's is the account's, so the songs of the server
open on demand (`configureLibrary`'s `serverBase`, set by k7 on the phone only —
`apps/k7/frontend/src/serverChoice.ts`). `songSide` is the whole rule:

| the song is | server answers | reads | writes |
|---|---|---|---|
| here alone | either | here | here |
| on the server alone | yes, or not known yet | server | server |
| on the server alone | no | — the page says it cannot be opened | — |
| on both | yes | server | server |
| on both | not known yet | here | server |
| on both | no | here | — read-only |

- **Edits go to the server's version** for every song the server holds, then the copy here is
  refreshed in the background, once a burst of edits settles (`refreshCopy`). Two copies edited apart
  would need a merge nobody can do on a phone; one version edited, and copies of it, need none.
- **While the server answers, a copied song is read there too**, so what was just written is what is
  read back. The copy landing changes nothing on the open page: no reload, no edit lost.
- **Away, everything is read-only, and the page says why** (`ReadOnlyNotice`): every edit control is
  disabled rather than left to fail. Whether the server answers is the backend's
  `/api/sync/library/status`, a stale placement saying away too
  (`../../mediatek/docs/serverCopy.md`).
- **Not known yet reads the copy**: a phone started offline opens its songs at once rather than after
  a ping's timeout.
- **A song of the phone alone stays the phone's**, read and written locally, as anywhere else.

Everywhere else — the tray, a server — every song reads and writes the pages' library, as before:
the tray chooses its server with the picker instead (`apps/k7/frontend/docs/serverPicker.md`).

## Its audio

A song not copied yet streams from the server through the forward (`Playable.base`), and so plays in
the browser even when an engine answers: the engine plays files of its own machine
([playbackTarget.md](playbackTarget.md)). Once the copy is here, the next start plays it on the engine.

## The first look copies it

Opening a server song with no copy queues its download (`useOpenSong`), the same download-manager job
as its cloud button, so a second look or a click on the button fetches nothing twice. The whole song
comes down, audio included, on any network: a song consulted is a song about to be rehearsed, and the
rehearsal room is where the network is worst. Why that is the phone's rule and not the tray's is
`../../mediatek/docs/serverCopy.md`.
