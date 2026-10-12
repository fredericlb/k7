# The bench — a live rig you throw away

A chain cannot be judged from its file. What it does has to be heard, and a loaded plugin — the
only place its parameter names, their bounds and its factory presets exist — lives inside a project
and nowhere else.

The bench is that project, and it opens by **address**. What answers is a `live` rig — an input, a
fader, the master run out — with the origin's libraries beside it, which is where every module it
can name comes from. A bench always names the chain it is ON:

- **`/@banc/<chain ref>/live.st0`** — the rig with a **copy** of that library chain between the
  input and the fader (`/@banc/vocals/warm/live.st0`, `/@banc/@st0/vocals/warm/live.st0`). It is
  how a chain is HEARD on a live input — the rehearsal recorder records through it
  ([chainSource.md](../../../../../packages/ui-rehearsal/docs/chainSource.md)) — anyone may open it, and it edits
  no library. The copy is the RIG's own: the template's steps become the rig's segments and node
  files, a chain file's nodes named after the modules they extend, since an id says nothing on a
  card (`packages/file-service/src/benchChain.ts`). The rig stays a segment project so the one
  scaffold `live` writes is the one the bench opens.

The bare `/@banc/live.st0` is refused, and so is a bare library ref, `/@banc/@st0/live.st0`. A rig
on nothing would play nothing in particular, and a library is not edited on a bench: an admin edits
it from any project ([apps/st0/frontend/docs/sharedModules.md](../../../frontend/docs/sharedModules.md)).

> **Nothing in the RIG is saved.** The folder is deleted and written again on every open. What an
> admin writes into a LIBRARY from the rig is kept the way it is from any project: in the admin's
> own clone of that library, until it is pushed or discarded from the editor's bottom bar
> ([packages/file-service/docs/libraries.md](../../../../../packages/file-service/docs/libraries.md)).

## Disposable is the decision

A bench is a question, not an answer. You open it to hear what a chain does, and the graph wired
to hear it is worth nothing the moment the question is answered. Keeping it would mean a project
nobody opens on purpose collecting state — a rig that has drifted since the last time, whose sound
is explained by something you did a month ago.

So the shape is `live`: no arrangement, no lane, no surface. The same scaffold `st0` writes for a
`live` project ([packages/song/docs/liveProject.md](../../../../../packages/song/docs/liveProject.md)),
and the same file that writes it — a second copy of a rig is a second rig to keep in step.

The graph it opens on is what you make of it. Add nodes and try two settings of the same module
side by side. None of it is there next time.

## What it needs

The **library** — every module the rig can name is in one, except the fader: it is a use of
`@meta/audio/mixer`, which ships with st0 (`packages/song/docs/metaModules.md`). So the file service
refuses a bench before the origin lists a library. The workspace the rig sits in is the bench's
own, `Banc`, reserved by convention the way `Examples` is.

## A CHAIN is not edited on a chain's bench

Seeding is not editing: what is turned on the copy reaches nothing shared. A chain meant to last is
edited in its library — from the chains builder, by an admin, in any project — and pushed from the
editor's bottom bar. Anything else under `@banc` — `chains/<path>.st0`, `modules.st0` — is a 404
whose sentence says where the editing happens.

A chain with a **cold** step is refused on the seeded address, since it cannot run on a live input
(`packages/file-service/src/benchChain.ts`).

## What it is not

- **Not a git repository.** The rig has no URI, it is not cloned, it is not pushed.
  Version-controlling it would mean version-controlling something deleted on the next open. That is
  why the address carries a **reserved** repository name, `@banc`: `@` cannot start a git short
  name, so collision is impossible, and `@studio/project-shell`'s gate takes another route on seeing
  it — no name resolution on the server, no clone, one call to the machine.
- **Not in the song's way.** It plays in a session of its own, `banc:<you>`, so it opens beside the
  song you have open rather than taking its place — on the same engine, since your files drive one
  engine at a time ([packages/engine-registry/docs/claim.md](../../../../../packages/engine-registry/docs/claim.md)).
- **Not shared.** It lives in your account's `Banc` workspace, on the chosen machine. Two people
  have two benches — and, by the "one project, one engine" rule
  ([claim.md](../../../../../packages/engine-registry/docs/claim.md)), two different addresses, so
  neither takes the other's.
- **Not a song.** Nothing is arranged and nothing is written down. What a trial produces that is
  worth keeping is a module or a chain in the library, or a take off the rig's recorder.

## What to check in a browser

None of this is covered by a green suite past `packages/file-service/src/bench.test.ts`, which
proves the folder is rebuilt and that nothing leaves it.

- open `/@banc/<chain ref>/live.st0` → the chain sits between `IN` and `fader`; the library's own
  copy was never written;
- turn a knob on the seeded chain, reopen the bench → the rig is the seeded scaffold again, and what
  you turned is gone;
- open `/@banc/@st0/live.st0` → refused: `@st0` is a library, not a chain;
- open `/@banc/live.st0`, `/@banc/chains/x.st0` or `/@banc/modules.st0` → a refusal saying where a
  chain and a module are edited.
