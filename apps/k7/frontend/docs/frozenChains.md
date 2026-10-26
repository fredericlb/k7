# Frozen chains — `/libraries/chains`

A frozen chain is a chain built once and reused: to process a track, a clip or an event
(`clip process <clip> @account/<name>`, `packages/audio-passes/docs/processChain.md`), or to
record a rehearsal session through it live (`packages/ui-rehearsal/docs/chainSource.md`). The page
lists the account's own, which it builds and edits, and the libraries' **cold** chains beside them,
read-only, to duplicate from. A cold chain is one of them, not a kind apart: it is a frozen chain
whose one step separates a file.

## Kept in the account's library, as an ordinary chain

A saved chain is `@account/chains/<name>.k7x`, the account's own library
(`packages/song/docs/sharedFolders.md`): always the account's to write, synced like the rest of it,
and walked FIRST by every chain reader. So nothing had to learn about frozen chains: the process
verbs, the recorder's live list and the bench find one the moment it is written. An origin library
stays an admin's to write, which is why the libraries' chains are shown read-only and copied rather
than edited.

`@account/<name>` is the spelling to use in a project. A bare name prefers the default library's
chain of that name (`resolveChain`), so a frozen chain does not silently replace one.

## Built with no project

The page opens no project and no engine, so a step's knobs are read from the module's panel
(`ui.k7x`: each widget's `bind`, `min`, `max`, `label`), with the module's defaults, rather than
from a loaded plugin. A module with engines picks one, and its values are written under that engine
(`engines.<engine>.params`), the only place an engine reads them. A step keeps only the values that
were moved: the module's defaults rule the rest, and a default fixed in the library later still
reaches the chain.

What a person cannot judge on this page — how it sounds — is the bench's: a chain that can run live
is recorded through from the rehearsal recorder, where the engine plays it.

## The two rules the file service enforces

- **A chain separates or it treats.** A separating (offline) module writes files instead of a
  signal, so nothing could follow it: a chain holding one holds nothing else, the rule the process
  verbs already apply.
- **A saved file must read.** The text is read back as a chain before it is written, so the page
  can never leave behind a file a chain reader refuses.

The routes are the account's (`/account/frozen-chains`, `/account/chain-modules`), answered with no
workspace like the cold-chain settings (`packages/file-service/docs/libraries.md`).
