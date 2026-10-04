# The bench — a live rig you throw away

A module cannot be judged from its file. What it does has to be heard, and a loaded plugin — the
only place its parameter names, their bounds and its factory presets exist — lives inside a project
and nowhere else.

The bench is that project, and it opens by **address**. What answers is a `live` rig — an input, a
fader, the master run out — with the origin's libraries beside it, which is where every module it
can name comes from. There are two, and a bench always names what it is ON:

- **`/@banc/@<library>/live.st0`** — an admin's bench ON a library: the rig, with that library
  read from a clone of the admin's own instead of the server's. It is the only place a library is
  written ([apps/st0/frontend/docs/sharedModules.md](../../st0/frontend/docs/sharedModules.md)), and
  it is opened from the library's row in st0's Libraries panel. Anyone else gets a 403: a library
  is every account's, and only the origin's admins change it.
- **`/@banc/<chain ref>/live.st0`** — the rig with a **copy** of that library chain between the
  input and the fader. It is how a chain is HEARD on a live input — k7 records through it
  ([apps/k7/docs/chainSource.md](../../k7/docs/chainSource.md)) — anyone may open it, and it edits
  no library: opening it ends any library overlay.

The bare `/@banc/live.st0` is refused. A rig on nothing would edit nothing and play nothing in
particular, and the place to hear a module is the bench of its library.

> **Nothing in the RIG is saved.** The folder is deleted and written again on every open. What a
> library bench keeps is what was written into the LIBRARY: those edits stay in the bench's clone
> until they are pushed or discarded from the editor's bottom row, and reopening the bench resumes
> them ([packages/file-service/docs/libraries.md](../../../packages/file-service/docs/libraries.md)).

## Disposable is the decision

A bench is a question, not an answer. You open it to hear what a module does, and the graph wired
to hear it is worth nothing the moment the question is answered. Keeping it would mean a project
nobody opens on purpose collecting state — a rig that has drifted since the last time, whose sound
is explained by something you did a month ago.

So the shape is `live`: no arrangement, no lane, no surface. The same scaffold `st0` writes for a
`live` project ([packages/song/docs/liveProject.md](../../../packages/song/docs/liveProject.md)),
and the same file that writes it — a second copy of a rig is a second rig to keep in step.

The graph it opens on is what you make of it. Name a module between the input and the fader and it
is an effects chain; add nodes and try two settings of the same module side by side. None of it is
there next time.

## What it needs

The **library** — every module the rig can name is in one, except the fader: it is a use of
`@meta/audio/mixer`, which ships with st0 (`packages/song/docs/metaModules.md`). So the file service
refuses a bench before the origin lists a library. An empty library gives a fader that resolves to
nothing, exactly as it would in any other `live` project.

A library bench's clone is made from the library's remote with the ADMIN's key, because the push is
theirs; the server's own key only reads. It is kept until a push leaves it clean, so unpublished
work is never thrown away by a reopen. The workspace the rig sits in is the bench's own, `Banc`,
reserved by convention the way `Examples` is.

## A CHAIN is not edited on a chain's bench

Seeding is not editing: what is turned on the copy reaches nothing shared. A chain meant to last is
edited in its library — from the chains builder, in a project the admin has open while that
library's bench is open, or on the bench itself — and pushed from there. Anything else under `@banc`
— `chains/<path>.st0`, `modules.st0` — is a 404 whose sentence says where the editing happens.

A chain with a **cold** step is refused on the seeded address, since it cannot run on a live input
(`packages/file-service/src/benchChain.ts`).

## What it is not

- **Not a git repository.** The rig has no URI, it is not cloned, it is not pushed.
  Version-controlling it would mean version-controlling something deleted on the next open. That is
  why the address carries a **reserved** repository name, `@banc`: `@` cannot start a git short
  name, so collision is impossible, and `@studio/project-shell`'s gate takes another route on seeing
  it — no name resolution at pl8, no clone, one call to the machine. The library a bench edits is a
  repository, held beside the rig, never in it.
- **Not in the song's way.** It plays in a session of its own, `banc:<you>`, so it opens beside the
  song you have open rather than taking its place — on the same engine, since your files drive one
  engine at a time ([packages/engine-registry/docs/claim.md](../../../packages/engine-registry/docs/claim.md)).
- **Not shared.** It lives in your account's `Banc` workspace, on the chosen machine. Two people
  have two benches — and, by the "one project, one engine" rule
  ([claim.md](../../../packages/engine-registry/docs/claim.md)), two different addresses, so
  neither takes the other's.
- **Not a song.** Nothing is arranged and nothing is written down. What a trial produces that is
  worth keeping is a module in the library, or a take off the rig's recorder.

## What to check in a browser

None of this is covered by a green suite past `packages/file-service/src/bench.test.ts`, which
proves the folder is rebuilt and that nothing leaves it.

- as an admin, open `@st0`'s **Bench** from the Libraries panel → the graph shows the input, the
  fader and the master run, with no library chain named anywhere;
- name a library module in the graph, save, listen → it is in the run;
- reopen the bench → the graph is the scaffold again, and what you wired is gone;
- edit a library module on the bench, reopen it → the edit is there, unpushed, and the bottom row
  still offers to commit or discard it;
- open `/@banc/@st0/live.st0` as a non-admin → refused;
- open `/@banc/<chain ref>/live.st0` → the chain sits between `IN` and `fader`; the library's own
  copy was never written;
- open `/@banc/live.st0`, `/@banc/chains/x.st0` or `/@banc/modules.st0` → a refusal saying where a
  chain and a module are edited.
