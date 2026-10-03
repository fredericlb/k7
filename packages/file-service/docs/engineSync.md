# engineSync — a project's files are on the engine's machine before it plays

A hosted workspace lives on the server; the engine opens files by LOCAL path on its own machine.
Something has to copy them across, and **when** it does is the whole decision: a download on the
engine's channel holds every frame queued behind it — a `transport play`, a fader, a knob — for as
long as the file takes to arrive. Mid-set, that is a lag nobody can explain from the screen.

So the copy happens **before the document is sent**, off the engine's channel, with a progress bar:
`engineSync.ts` (`sendWhenSynced`), called by `engineLink.ts`'s `sendDoc` for every document — the
compiled project on ▶, and the one a browser hands over (the DJ desk putting a record on).

## What is copied, and what is asked again

Every absolute path the document names that is a file here, plus the songs the open projects' set
lists name (`namedSongFiles`, `mediatekPrefetch.ts`), so a record from the playlist is already on the
machine when it goes on a deck. A file is asked for when this service has not seen the machine take
it **at its current size and mtime**; afterwards only a NEW or CHANGED file is copied — a clip just
uploaded, a freeze rendered again, a record from outside the set list. Those hold the next document
back the same way, bar included, and still never touch the engine's channel.

The ledger is the bound machine's: binding another one forgets it, and the machine's own size+mtime
check still skips a file its cache already holds (`packages/engine-tunnel/docs/tunnel.md`).

## While it copies

- The document is held, and the latest one asked for is the one sent when the copy ends — after
  passing the gate again, since it may name a file this copy did not carry.
- `GET /workspace` carries `engineSync` (`EngineSyncState`, `@studio/web-protocol`): counts of what
  the machine actually had to copy, not of what was asked. st0's footer draws it
  (`apps/st0/frontend/src/components/EngineSyncProgress.tsx`) and Play waits for it.
- The engine-health reconcile skips a session whose copy is running: the engine not holding the
  project yet is not the engine's fault.

## When it goes wrong

- **A file did not arrive**: the document is sent anyway — the engine plays the rest and that clip
  is silent — and the footer says how many are missing. Those files stay unsettled, so the next
  document asks for them again.
- **The copy failed outright** (the tunnel dropped): the same, with the error in the footer.
- **A machine that does not know `sync`** answers so by name. It still downloads on the engine
  channel itself, as it ignores the `synced` flag the binding opens that channel with
  (`packages/file-hub/binding.ts`), so the document is sent at once and the machine is not asked
  again. That is what lets the server ship before every machine has updated.

## Not covered

- A local engine — no machine bound, nothing to copy: the document is sent at once.
- `preview` (auditioning a file) names its file outside any document; a file nothing has copied yet
  is silent on a synced channel.
- Uploads the other way — a take, a plugin snapshot — still cross on the engine's channel before the
  frame naming them reaches the server.
