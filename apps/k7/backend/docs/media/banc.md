# The bench — a live rig where a chain is heard and tuned

A chain cannot be judged from its file. What it does has to be heard, and a loaded plugin — the
only place its parameter names, their bounds and its factory presets exist — lives inside a project
and nowhere else.

The bench is that project, and it opens by **address**. What answers is a `live` rig — an input, a
fader, the master run out — with the origin's libraries beside it, which is where every module it
can name comes from:

- **`/@banc/<chain ref>/live.k7`** — the rig with a **copy** of that library chain between the
  input and the fader (`/@banc/@k7-core/vocals/warm/live.k7`, `/@banc/@account/warm-vox/live.k7`).
  It is how a chain is HEARD on a live input — the rehearsal recorder records through it
  ([chainSource.md](../../../../../packages/ui-rehearsal/docs/chainSource.md)) — and how one of the
  account's frozen chains is EDITED ([frozenChains.md](../../../frontend/docs/frozenChains.md)). The
  copy is the RIG's own: the template's steps become the rig's segments and node files, a chain
  file's nodes named after the modules they extend, since an id says nothing on a card
  (`packages/file-service/src/benchChain.ts`).
- **`/@banc/live.k7`** — the bare rig, input straight to the fader: where a new chain is built.

A bare library ref, `/@banc/@k7-core/live.k7`, is refused: a library is not edited on a bench, an
admin edits it from any project ([apps/k7/frontend/docs/sharedModules.md](../../../frontend/docs/sharedModules.md)).

## What is kept, and where

**`chain save [name]` is the one way out.** It writes the run from `IN` to `fader` as
`@account/chains/<name>.k7x`, the account's own library, each node file whole, under the id of the
step it was copied from; a bench opened on one of the account's chains saves into it without being
told a name. The project bar's Save button runs it (`BenchSaveButton.tsx`). A run that branches, or
holds nothing, is refused: a template is one run. An origin library is never written from here.

**What the bench copied is recorded beside it**, in `Banc/bench-source.json`: the chain, which node
came from which step, and a fingerprint of the rig as it was made. It sits outside the project so
the editor's tree never shows it.

**A reload keeps what was turned.** The gate opens the bench again on every page load, and a rig
whose fingerprint moved since it was made, on the same chain, is left as it is; any other address,
or a rig left untouched, is scaffolded fresh. So knobs survive a reload until they are saved or
another chain is opened, which also means the rehearsal recorder, opening the same chain, records
through those turned knobs.

## The shape is `live`

No arrangement, no lane, no surface: the same scaffold `k7` writes for a `live` project
([packages/song/docs/liveProject.md](../../../../../packages/song/docs/liveProject.md)), and the
same file that writes it — a second copy of a rig is a second rig to keep in step. The rig is a
GRAPH project rather than chain files, since `spliceChain` wires the chain between nodes it names.

## What it needs

The **library** — every module the rig can name is in one, except the fader: it is a use of
`@meta/audio/mixer`, which ships with k7 (`packages/song/docs/metaModules.md`). So the file service
refuses a bench before the origin lists a library. The workspace the rig sits in is the bench's
own, `Banc`, reserved by convention the way `Examples` is.

A chain with a **cold** step is refused on the seeded address, since it cannot run on a live input
(`packages/file-service/src/benchChain.ts`). Anything else under `@banc` — `chains/<path>.k7`,
`modules.k7` — is a 404 whose sentence says where the editing happens.

## What it is not

- **Not a git repository.** The rig has no URI, it is not cloned, it is not pushed. That is why the
  address carries a **reserved** repository name, `@banc`: `@` cannot start a git short name, so
  collision is impossible, and `@studio/project-shell`'s gate takes another route on seeing it — no
  name resolution on the server, no clone, one call to the machine.
- **Not in the song's way.** It plays in a session of its own, `banc:<you>`, so it opens beside the
  song you have open rather than taking its place — on the same engine, since your files drive one
  engine at a time ([packages/engine-registry/docs/claim.md](../../../../../packages/engine-registry/docs/claim.md)).
- **Not shared, and one at a time.** It lives in your account's `Banc` workspace, on the chosen
  machine: one bench per account, so a second tab on another chain replaces the first's rig.
- **Not a song.** Nothing is arranged. What a trial produces that is worth keeping is a chain saved
  with `chain save`, or a take off the rig's recorder.

## What to check in a browser

`packages/file-service/src/bench.test.ts` and `frozenChains.test.ts` prove the folder, the kept
edits and the save; the screen is a browser's:

- open `/@banc/<chain ref>/live.k7` → the chain sits between `IN` and `fader`; the library's own
  copy was never written;
- turn a knob, reload → the knob is where you left it; open another chain → the rig is fresh;
- open `/@banc/live.k7`, add a module between `IN` and `fader`, press Save and name it → the page
  reopens on `/@banc/@account/<name>/live.k7`, and the chain is listed on the Frozen chains page;
- open `/@banc/@k7-core/live.k7` → refused: `@k7-core` is a library, not a chain.
