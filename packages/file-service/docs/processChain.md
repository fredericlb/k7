# Resolving a cut — which model, which outputs

A cut runs on an engine's machine (`packages/stem-separation/docs/stemSplit.md`); what it runs is
decided HERE, in the account's file service, because this is where the account's library and its
standing answers live. `resolveColdRun` (`coldRun.ts`) turns a chain and a `want` into a model and
the outputs it writes, and the hub asks it on pl8's behalf (`POST /hub/cold-chain`,
`packages/file-hub/docs/fileHub.md`).

## Four decisions

**The chain is resolved against the LIBRARIES, not a project.** `resolveChain` wants a project
directory, but pl8 has no project and no workspace. The libraries are the origin's — the file hub's
one clone of each, the same for every project — so any directory answers identically, and
the bench's is used because it is always the same one (`benchDir`). A server that has cloned no
library yet is refused by name.

**The chain is optional, and its default is the account's.** Which module separates and which
model it wants is one answer per account — settled once by `system stems`, and asking again at every
use is asking the same person the same question. A caller that does have an opinion names one.

**`want` says WHICH of those answers to fall back to**, `stems` or `instrumental`, and there are two
because they are two chains: the same model, and a module declaring `instrumental` as its single
output instead of the four stems. A caller asking for the instrumental over a chain that writes four
stems is refused by name rather than handed four files.

**A pass writes what the chain's module DECLARES.** `instrumental` is the one output name that is
not a stem: every stem the voice is not, summed while the parts are still in memory — on the
machine that cut them, so three stems never cross a network to be thrown away.

## What it does not do

A chain either **separates** or **bounces**; `resolveChain` refuses one that does both, because a
step after a separator would have four inputs and no way to name one. Only the separating half is
a cut. A bouncing chain is refused **by name** — the sentence says how many modules it found.
