# The bench — an st0 project that IS a médiathèque chain

A chain is a routing. What it does cannot be read in its file: it has to be heard. And a loaded
plugin — the only place its parameter names, their bounds and its factory presets exist — only
lives inside a project.

The bench is that project, and it opens by **address**: `/@banc/chains/<path>.st0`. st0 finds an
empty project whose `modules/` folder is the catalogue, and whose `graph.yaml` **is** the chain
you came to edit.

> **The bench is a CHAIN's, and nothing else's.** A shared module is edited from the
> **Libraries** tab of any already-open project's tree, against the engine that is already
> playing the song — and that song very probably already names the module you want to change.
> The two things module editing needs, an editable catalogue and a loaded plugin, are both there
> without fabricating anything. See
> [apps/st0/frontend/docs/sharedModules.md](../../st0/frontend/docs/sharedModules.md).
>
> `/@banc/modules.st0` therefore answers a 404 whose sentence says where the editing happens.

## How it is built

On every open, deliberately:

1. **a full sync of the `chains` and `modules` families.** `mediatekPull` only fetches what OPEN
   projects name ([mediatekPull.md](../../../packages/file-service/docs/mediatekPull.md)), and a
   bench that does not exist yet names nothing — without this pass it would reflect whatever was
   lying in the cache for other songs. This is the visible wait on a first open;
2. **the scaffold**, first time only (`@studio/song/scaffoldBench`);
3. **the mirror**: `modules/` is emptied and rebuilt from the cache, because the chain names
   catalogue modules and would not resolve without them. Definitions (`*.yaml`, `*.ts`,
   `*.vstpreset`) are **copied**, because they are what gets written — a hard link edited in place
   would edit the cache, and the cache is overwritten by the next sync. Everything else —
   impulses, NAM profiles, samples — is **hard-linked** where the filesystem allows and copied
   otherwise: those are the big files, nothing edits them, and duplicating their bytes on every
   open is the one thing that would make this bench expensive;
4. **the chain**, rewritten from the cache with its two edges translated (below), and `nodes/`
   copied across — the other half of what a chain is.

A module's name is its path **under its type folder**: `tape-delay` for
`modules/audio/tape-delay/`, `amps/neural-amp-modeler` for
`modules/audio/amps/neural-amp-modeler/`, which is filed one level deeper. The médiathèque
arranges its catalogue that way, and the bench mirrors it.

> The two walkers have to agree on that nesting level: the shared-libraries one
> (`readModuleTree`) and the project-local `modules/` one (`loadModules`), which silently skips a
> folder with no `module.yaml`. A disagreement does not read as an error — the module is simply
> not there, and each symptom talks about something else: a chain naming a module "this project
> does not have", a 400 from `/module-ui` on a file plainly visible in the tree.
> `packages/song/src/filedModules.test.ts` keeps them in agreement.

A module deleted from the catalogue therefore disappears from the bench. That is the point: a
stale module would still resolve, still compile and still play, which is how you spend an hour
debugging something that no longer exists.

## A project that writes into the médiathèque

Everywhere else, saving a shared module **forks** it into the project and rewires the chains onto
the copy (`packages/song/docs/moduleFork.md`). That is the right rule: a song that modified a
catalogue module would change the sound of every other song using it, unasked.

The bench is an exception, because it is **only** that. You do not open it to make a song; you
open it to work on a shared chain. Forking a copy here would write into a folder that is
regenerated on the next open — that is, throwing the work away in silence.

The marker that authorises it is a `project.yaml` field, `mediatekBench: true`, written by the
generator and by nobody else. It is in the schema (`ProjectSettingsSchema` is `.strict()`), so a
project carrying it by hand would open too — a key reserved by convention, exactly like the
workspace name `Banc`.

Stated plainly, the posture this changes: **the file service becomes a writer of the catalogue**.
That is the same kind of decision as the one forbidding pl8 to write into git repositories
([projects.md](projects.md), "Why pl8 writes into no repository"), settled the other way —
because the catalogue is already the studio's one editable place.

> The Libraries tab settles the same question a third way: it writes to pl8, which is the
> library, then asks the machine to resync its cache. Both paths exist because they start
> somewhere different — the bench writes from the machine, which has the file; st0 writes from
> the browser, which has the session.

## Translating the edges

A shared chain runs from `@in` to `@out`: it describes a treatment and says nothing about what
crosses it. An st0 project has neither — it has a track, a strip, an output. The two files are
otherwise exactly the same shape, so opening **converts** nothing: it renames the two edges, and
saving renames them back.

| in the médiathèque | on the bench |
|---|---|
| `"@in": [ … ]` under `modules:` | `banc: [ … ]` — the track |
| a destination `"@out"` | `mixer`, then `mixer: [ OUT ]` |

Both directions live in one file, `packages/song/src/benchChain.ts`, under one set of round-trip
tests: separated they would drift, and drift here means a shared chain silently rewritten.
`packages/file-service/src/benchChainProject.test.ts` does the whole loop through the disk,
because this is the service's only path that writes into a **shared** catalogue.

The strip is added only if something reaches it: an `@in → @out` chain does not leave with
furniture it never crossed. And the top comment block is preserved separately — `formatChains`
re-emits a canonical document, which is what makes the round trip demonstrable and would eat
every comment; the top one carries what the chain IS.

### What is refused

A chain that already has a node called `mixer`, `OUT` or `banc` does not open, and the message
says so. Saving would strip the bench's own strip and take the chain's module with it; renaming
by fiat would change the chain you came to edit. The gate shows it as a project not found — the
service's sentence is the whole explanation.

### What goes back, and what stays

`graph.yaml` (translated back) and `nodes/` return to the médiathèque's `chains/<path>/`. The
rest — `project.yaml`, the `modules/` mirror, and the bench track — is the bench's furniture and
has no business in a chain other projects load. The track is in `nodes/` like the others, so what
holds it here is its NAME (`BENCH_EDGES.track`) and nothing else.

The write touches the local cache too, not only the hosted library. The bench rewrites
`graph.yaml` from the cache on every open, so on a machine with no hosted library — where the
cache IS the library — a save that only pushed would be thrown away by the next open.

> Trap to know: the active project path `write()` receives is **already absolute**. Gluing it
> back onto the workspace root gives `<root>/<root>/<project>`, which is under no write — the
> promotion of a file back to the catalogue would never fire, silently. A test holds it.

## What it is not

- **Not a git repository.** It has no URI, it is not cloned, it is not pushed. Version-controlling
  it would mean version-controlling a cache. That is why the address carries a **reserved**
  repository name, `@banc`: `@` cannot start a git short name, so collision is impossible, and
  `@studio/project-shell`'s gate takes another route on seeing it — no name resolution at pl8, no
  clone, one call to the machine.
- **Not shared.** It lives in your account's `Banc` workspace, on the chosen machine. Two people
  have two benches — and, by the "one project, one engine" rule
  ([claim.md](../../../packages/engine-registry/docs/claim.md)), two different addresses, so
  neither takes the other's.
- **Not a song.** Nothing is arranged and nothing is recorded (`recordDir` is not set, the track
  has no clip). What you want to keep from a trial, you keep in the chain.

  So the bench declares **no surface**: no `surfaces/timeline.yaml`, no `surfaces/viewport.yaml`.
  st0 opens it on the chains graph, full screen, with no transport and no minimap — a project
  draws what it DECLARES, and this one declares nothing. See
  [packages/song/docs/surfaces.md](../../../packages/song/docs/surfaces.md).

## What to check in a browser

None of this is covered by a green suite — `scaffoldBench.test.ts` only pins that the generated
project compiles.

- open a médiathèque chain on the bench → the graph shows the track, the module, the strip, the
  output;
- insert a module, save, go back to pl8 → the chain shows the module between `@in` and `@out`,
  and its header is intact;
- reopen the bench on the same chain → what you wired is there;
- open a chain naming a `mixer` → a readable refusal, and nothing created;
- open `/@banc/modules.st0` → a refusal saying where a module is edited.
