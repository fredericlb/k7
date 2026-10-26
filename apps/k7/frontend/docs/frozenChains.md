# Frozen chains — `/libraries/chains`

A frozen chain is a chain built once and reused: to process a track, a clip or an event
(`clip process <clip> @account/<name>`, `packages/audio-passes/docs/processChain.md`), or to
record a rehearsal session through it live (`packages/ui-rehearsal/docs/chainSource.md`). The page
lists the account's own and the libraries' **cold** chains beside them, read-only, to duplicate
from. A cold chain is one of them, not a kind apart: it is a frozen chain whose one step separates
a file.

## Built and edited on the bench

**New chain** opens the bare bench, and **Edit** opens the bench on the chain
(`apps/k7/backend/docs/media/banc.md`). The bench is a project with an engine, so a chain is edited
with the graph every project has: the modules' real panels and parameters, bypass, presets, the
plugin's own window, and the sound. The project bar's Save button runs `chain save`, which writes
the run between the input and the fader back as the chain. A page of its own with a form for steps
and knobs would be a second chain editor that can neither load a plugin nor play, so there is none.

A chain that cannot run live (a cold one) cannot be opened on the bench, and its Edit is disabled
with the reason. **Duplicate** copies any listed chain whole, every step's fields and preset, under
a name of the account's (`POST /account/frozen-chains/<name>/copy`).

## Kept in the account's library, as an ordinary chain

A saved chain is `@account/chains/<name>.k7x`, the account's own library
(`packages/song/docs/sharedFolders.md`): always the account's to write, synced like the rest of it,
and walked FIRST by every chain reader. So nothing had to learn about frozen chains: the process
verbs, the recorder's live list and the bench find one the moment it is written. An origin library
stays an admin's to write, which is why the libraries' chains are copied rather than edited.

`@account/<name>` is the spelling to use in a project. A bare name prefers the default library's
chain of that name (`resolveChain`), so a frozen chain does not silently replace one.

## The rules the file service enforces

- **A chain is one run.** The bench's graph from `IN` to `fader` must be one node after another; a
  branch, a loop or an empty run is refused by name.
- **A chain separates or it treats.** A separating (offline) module writes files instead of a
  signal, so nothing could follow it: a chain holding one holds nothing else.
- **A saved file must read.** The text is read back as a chain before it is written, so a save can
  never leave behind a file a chain reader refuses.
