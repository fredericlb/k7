# Talking to the engine's machine — the transport, and the routes on it

Two files, and the line between them is which MACHINE answers.

| | who answers | where |
|---|---|---|
| `src/fileApi.ts` + `src/project.ts` | the **file service**, on the engine's machine, cross-origin and header-authenticated | `base` from the engine probe |
| `src/repoLookup.ts` | **pl8**, at a fixed path on the page's own origin, with the session cookie | `serviceUrl(origin, "pl8")` |

`apps/st0/AGENTS.md` lists the three servers a project app talks to and which is which.

## The transport

Every call carries the same three headers — the user, the workspace, the engine token — and
everything in `project.ts` is built from two verbs, `fget` and `fsend`. `engineId` rides in the
config beside the token because it comes from the same probe; it is **not** used to reach the file
service, which is addressed by `base`. It is what a call to ANOTHER service must name when it is
about to borrow this machine — pl8's `/api/stems` is the first, holding the master and asking an
engine to cut it (`apps/pl8/docs/stems.md`), and the desk had no other way to say which machine it
was on.

`mediaUrl` is the exception that proves the header rule: an `<audio>`/`<video>` element GET cannot
send headers, so everything including the token rides in the query.

### A GET already in the air is joined, not re-issued

`fget` is **not a cache** — nothing is kept once a request settles, so two calls a second apart are
two requests. What it collapses is the burst. The derived views are asked for by several components
at once, every one of them on the same reload key, and each answer costs the service a real compile
or a real walk: in st0, four components re-fetch `/graph` on a reload and five `/project-doc`,
whichever are mounted. The service answered each separately, with the same bytes, out of a memo
they were all hitting — and the revision walk in front of that memo is ~5 ms every time.

An **epoch** is the fence. It counts writes through `fsend`, and a GET may only join one issued in
the same epoch; `fsend` bumps it on both edges, which matters both ways — the first stops a GET
issued while the write is in the air from joining one issued before it, the second covers the GET
that follows the reply. Without it, a component asking a millisecond after a command landed would
be handed the answer to a question asked before it, which is the one way sharing a request can lie.
Everything else that changes an answer — another tab, a `git pull` — is what `/revision` polling is
for, and it is no worse off than when every component asked separately: two requests could always
have straddled a change.

What is shared is the **body text**, and each caller parses it. That is the whole difference
between this and a cache: handing several components one parsed object would alias it, and a
surface that fills its decks' clips into the document it was given would be writing into another
component's state. Each caller pays the parse it always paid; what it stops paying is the round
trip and the service's work behind it.

### A frozen document is refused in ONE place

`FileCfg.frozen` is the whole of read-only mode, and that is deliberate. `fsend` is the only way
anything in these apps writes — around twenty-five call sites in `project.ts` alone — so throwing
`ReadOnlyDocument` there refuses everywhere, once, with a sentence, instead of neutering feature by
feature and meeting the twenty-sixth one in production. Hiding buttons was never the alternative: a
hidden button is still a keyboard shortcut, a command bar entry and a context menu away.
`ReadOnlyDocument` has its own type so a caller can tell "this cannot be done here" from "the
service refused", which read the same as a plain `Error`.

`frozen.canned` answers the routes a snapshot HAS no answer for. A share carries the three compiled
documents and nothing else — no `/tree`, no `/hints`, no `/git/status` — and without canned bodies
every hook that asks for one would draw an error banner about a service that is not merely down but
absent by design. The values are JSON **text** and not objects, for `fget`'s reason above: several
components parse the same body and must not be handed one object to alias. A canned answer
short-circuits before the request and is parsed per caller exactly as a real body is, so a
component cannot tell which kind it got. See `apps/pl8/docs/shares.md`.

### Blocked or unreachable

A refused CORS preflight and a dead server are the SAME rejection in JS: an opaque
`TypeError: NetworkError`, with no status and no body, because letting a page read that difference
is precisely what CORS exists to prevent. The difference is the whole of the next action — "click
allow in the tray" versus "start the engine".

`mode: "no-cors"` is the way through. It sends a simple GET with no preflight and no ACAO check,
yielding an opaque response nothing can read but whose ARRIVAL proves something answered.

| probe | conclusion |
|---|---|
| resolves | the service is up and refused our origin → `blocked` |
| rejects | nothing is listening at that address → `unreachable` |

Both `fget` and `fsend` carry the HTTP `status` onto the thrown `Error`, for the callers that have
to tell "nothing there" from "it went wrong" — the gate's `missing` screen is the main one.

## The routes, and the ones that surprise

`project.ts` is the shared client. st0 spreads it into its own and adds what only it has — timeline,
waveforms, video; z0's editor uses it as it stands.

- **Resolving what pl8 named.** pl8 knows a REPOSITORY; this machine knows folders.
  `workspaceByRepo` / `startClone` / `cloneStatus` bridge that, cloning when the machine has never
  seen one (`packages/file-service/docs/cloneJobs.md`).
- **`openBench`** replaces those three rather than sitting beside them: the bench has no
  repository, so there is no name to resolve and nothing to clone. `@banc` in the address routes
  here. It is slow the first time — a full modules sync — which is why it takes over the clone's
  progress screen rather than being asked for silently (`apps/pl8/docs/banc.md`). It is handed the
  account's library repository, because the chain being opened is IN it and so are the modules that
  chain names; and it is handed the project part of the address verbatim, because the MACHINE is
  what holds the médiathèque and therefore what decides whether `chains/<path>.st0` names one chain
  or the catalogue at large.
- **`open`** takes the library URI for the same reason: the BROWSER is the side that knows who is
  asking. It read the URI from pl8 a moment ago, on this person's session, where the file service
  holds a machine token and no session at all. The machine mounts it at `_libraries` if it is not
  there already (`packages/file-service/src/libraries.ts`).
- **`moduleLibraries` and `libraryChains`** sit beside `/tree` because that one is the SONG and
  these are outside it. A chain's `path` comes from the service rather than being built by the
  caller, exactly as a module library's does.
- **`sendEngineProject`** plays a document this browser built — the turntables surface's decks
  filled into the project's own compile. It goes through the file service rather than out of the
  app's socket so that ONE thing writes to the engine: the service already loads st0's project
  itself, and a second writer meant whichever pushed last would win
  (`packages/song/docs/surfaces.md`).
- **The derived views** — `projectDoc`, `engineDoc`, `videoDoc`, `graph`, `surfaces`,
  `projectErrors` — are expensive. `revision()` is the cheap token that changes when the sources
  do: poll THAT, not these.
- **`videoDoc`** is the same folder read as PICTURE. Two compilers over one folder, not one route
  with a flag: a song has a tempo and its picture has a viewport, and neither document has a field
  for the other's. A song with no `video_tracks/` answers with an EMPTY document rather than an
  error, so "no picture" and "broken picture" stay distinguishable at the call site.
- **`write`** on a file in the shared `_modules` library does not write there. It copies the module
  into the project and repoints the chains at the copy, and `forked` says where the edit actually
  landed. There is no opt-out — the catalogue is edited in the médiathèque.
- **`deleteFile`** recycles rather than erases: reversible, but no longer listed or startable.
- **`gitStatus`** fetches, so callers poll it rarely — st0 uses ten minutes. A workspace IS one
  clone, so none of the git routes needs a project.
- **`historyState`** enables the undo shortcuts. `confirm` applies a process step (restoring a
  bounced file); without it, a process step comes back `needsConfirm` for the client to gate.

### `command`, and the three optional fields in its reply

`want` is what a caller says when it will NOT draw a picture. `CommandWant` is a union of one, and
deliberately a list rather than a boolean: the question is "which of the pictures will I draw", so
the next expensive document to arrive is a member rather than a second flag beside the first.

`graph` comes back ONLY when the command changed the project AND the caller asked for it — the
service builds it once inside that request rather than making the caller fetch it. Building it is
~62 ms on a real song, on the one thread the service has, and st0 runs mute/solo/faders through a
path that never refetches the graph, so that whole class of gesture was paying for a document
nobody read. Omit the option and the graph comes back as it always did; pass `want: []` to say no.

`rev` does NOT depend on `want`: every writing command answers with the token it produced, which is
what lets a client stop re-asking what the reply already said.

`refused` is the same shape of fact about the other half — the command was understood and declined,
and the lines in `output` say why. Present only when true, so a surface that ignores it reads a
refusal exactly as it always did (see `packages/commands/docs/refusal.md`).

`changed` names the FILES it wrote, project-relative, out of the journal's own diff. It is what
lets a host reload only what depends on them; absent means the service could not say, which is
"re-ask everything" and never "nothing moved".

`at` points the verbs at a folder OTHER than the open project — the chains builder's template. It
is always a path the caller was GIVEN, by `libraryChains`, and never one it built.

## Two routes that used to be here

- **`prepareStems` / `separation`** stood against the file service's `/stems`. They are pl8's now:
  the library holds the masters, so it owns the cut and keeps the results, and the engine only
  lends its model over `/process`. This client speaks to ONE machine and pl8 is not it, so the two
  calls live where the library's other routes do — `mediatek` in `apps/st0/frontend/src/api.ts`.
  See `apps/pl8/docs/stems.md`.
- **`setInputPair`** remembered that two interface inputs are grouped into one stereo device, while
  the ENGINE was told separately over the caller's own socket: one act, two doors and no name.
  `system channel type <channel> <mono|stereo>` is both halves now, so the write goes down
  `/command` with every other act (`packages/ui-module-builder/docs/inputChannels.md`).

## Asking pl8: the two lookups

`repoLookup.ts` is same-origin — every studio service sits at a fixed path under one origin — so
the session cookie rides along without asking and there is no CORS to arrange. The path is asked of
`serviceUrl` rather than spelled, which is what let this file survive the swap that moved the
médiathèque off the origin root.

Both errors are raised in the SERVER's words, because pl8 is the side that can be specific — an
unknown name, or a name two repositories answer to.

`librariesRepo` answers `null` with a **200** and not a 404: "none set" is the ordinary state of a
new account, and a status code is the wrong place to keep the difference between that and a service
that is down. Only the second is worth a diagnosis. It is asked before the project is resolved, for
the reason `launch.md` gives at step 0.
