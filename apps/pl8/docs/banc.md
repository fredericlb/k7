# The bench — a live rig you throw away

A module cannot be judged from its file. What it does has to be heard, and a loaded plugin — the
only place its parameter names, their bounds and its factory presets exist — lives inside a project
and nowhere else.

The bench is that project, and it opens by **address**: `/@banc/live.st0`. One address, naming
nothing: no repository, no chain, no project of the account's. What answers is a `live` rig — an
input, a fader, the master run out — with the account's library mounted beside it, which is where
every module it can name comes from.

> **Nothing on the bench is saved.** The folder is deleted and written again on every open, and no
> write in it reaches anything shared. What a session keeps is what was written into the LIBRARY:
> a module edited there is written in place and published by a commit, like any other library edit.

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

## What it needs, and what it draws

The **library** — the fader is a use of `@st0/audio/utility/mixer`, and every module the rig can
name is in that repository. So st0's home page draws the bench card under the libraries one and
does not draw it at all before there is a library
([apps/st0/frontend/docs/projects.md](../../st0/frontend/docs/projects.md)). An empty library gives
a fader that resolves to nothing, exactly as it would in any other `live` project.

The clone the bench mounts is the one made when the library's URI was ADDED — validating the URI
and preparing the bench are the same work, so the first bench costs no clone of its own
([packages/file-service/docs/libraries.md](../../../packages/file-service/docs/libraries.md)). The
workspace it sits in is the bench's own, `Banc`, reserved by convention the way `Examples` is.

## A CHAIN is not edited here

A chain of the library is authored from a project you already have open: the chains builder writes
it and the Libraries tab holds it, against the engine already playing the song — and that song very
probably already names the modules the chain is made of
([apps/st0/frontend/docs/sharedModules.md](../../st0/frontend/docs/sharedModules.md)).

That is the same reason a MODULE is not edited here either. The two things editing needs, an
editable catalogue and a loaded plugin, are both there without fabricating anything.

`/@banc/` therefore answers exactly one project. Anything else under it — `chains/<path>.st0`,
`modules.st0` — is a 404 whose sentence says where the editing happens.

## What it is not

- **Not a git repository.** It has no URI, it is not cloned, it is not pushed. Version-controlling
  it would mean version-controlling something deleted on the next open. That is why the address
  carries a **reserved** repository name, `@banc`: `@` cannot start a git short name, so collision
  is impossible, and `@studio/project-shell`'s gate takes another route on seeing it — no name
  resolution at pl8, no clone, one call to the machine.
- **Not shared.** It lives in your account's `Banc` workspace, on the chosen machine. Two people
  have two benches — and, by the "one project, one engine" rule
  ([claim.md](../../../packages/engine-registry/docs/claim.md)), two different addresses, so
  neither takes the other's.
- **Not a song.** Nothing is arranged and nothing is written down. What a trial produces that is
  worth keeping is a module in the library, or a take off the rig's recorder.

## What to check in a browser

None of this is covered by a green suite past `packages/file-service/src/bench.test.ts`, which
proves the folder is rebuilt and that nothing leaves it.

- open the bench from the home page → the graph shows the input, the fader and the master run,
  with no library chain named anywhere;
- name a library module in the graph, save, listen → it is in the run;
- reopen the bench → the graph is the scaffold again, and what you wired is gone;
- edit a library module from the tree, reopen the bench → the edit is there, because it is in the
  library and not in the bench;
- open `/@banc/chains/x.st0` or `/@banc/modules.st0` → a refusal saying where a chain and a module
  are edited.
