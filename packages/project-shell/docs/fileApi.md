# Talking to the engine's machine — the transport, and the routes on it

Two files, and the line between them is which MACHINE answers.

| | who answers | where |
|---|---|---|
| `src/fileApi.ts` + `src/files.ts` + `src/project.ts` | the **file service**, on the engine's machine, cross-origin and header-authenticated | `base` from the engine probe |
| `src/repoLookup.ts` | **the media library**, k7's backend, at a fixed path on the page's own origin, with the session cookie | `serviceUrl(origin, "pl8")` |

`apps/k7/AGENTS.md` lists the three servers a project app talks to and which is which.

## The transport

Every call carries the same three headers — the user, the workspace, the engine token — and
everything in `project.ts` is built from two verbs, `fget` and `fsend`. `engineId` rides in the
config beside the token because it comes from the same probe; it is **not** used to reach the file
service, which is addressed by `base`. It is what a call to ANOTHER service must name when it is
about to borrow this machine — the media library's `/api/stems` is the first, holding the master and asking an
engine to cut it (`apps/k7/backend/docs/media/stems.md`) — and it is the only way the desk can say which
machine it is on.

`mediaUrl` is the exception that proves the header rule: an `<audio>`/`<video>` element GET cannot
send headers, so everything including the token rides in the query.

### A GET already in the air is joined, not re-issued

`fget` is **not a cache** — nothing is kept once a request settles, so two calls a second apart are
two requests. What it collapses is the burst. The derived views are asked for by several components
at once, every one of them on the same reload key, and each answer costs the service a real compile
or a real walk: in k7, four components re-fetch `/graph` on a reload and five `/project-doc`,
whichever are mounted. Without this the service answers each separately, with the same bytes, out
of a memo they all hit — and the revision walk in front of that memo is ~5 ms every time.

An **epoch** is the fence. It counts writes through `fsend`, and a GET may only join one issued in
the same epoch; `fsend` bumps it on both edges, which matters both ways — the first stops a GET
issued while the write is in the air from joining one issued before it, the second covers the GET
that follows the reply. Without it, a component asking a millisecond after a command landed would
be handed the answer to a question asked before it, which is the one way sharing a request can lie.
Everything else that changes an answer — another tab, a `git pull` — is what `/revision` polling is
for, and sharing costs it nothing: two separate requests can straddle a change just as easily.

What is shared is the **body text**, and each caller parses it. That is the whole difference
between this and a cache: handing several components one parsed object would alias it, and a
surface that fills its decks' clips into the document it was given would be writing into another
component's state. Each caller pays the parse it always paid; what it stops paying is the round
trip and the service's work behind it.

### …and one exception, opted into: a compiled view at the same token

Joining one request still leaves a second one, sent by a view that mounts just after the first
answer arrives. When k7 opens a project, the timeline and the graph panes ask for `/graph` and
`/project-doc` this way, a few hundred milliseconds apart. On a phone, that second `/graph` cost
over a second, at the moment the waveforms were loading. A page that polls `/revision` can
therefore declare, with `setFileApiRevision(token, derived)`, which routes are computed only from
the project at a given token. Their settled body is kept for five seconds under
`<epoch>\n<token>\n<path>`, and an ask under the same key is answered from it.

The key keeps this as safe as joining a request:

- **A write** from this tab bumps the epoch. The exception is a POST that changes no project file,
  such as a waveform prewarm, which writes only sidecars outside the token. It passes
  `{ fence: false }`. Without that, the prewarm the page sends on opening landed between the two
  reads every time.
- **An outside edit** moves the token at the next poll. The page reacts to that move by asking
  again, and the new token makes it a new key.

Every other route, such as `/revision` itself, `/workspace` or the waveform status, is never kept.

### A read has a budget, a write has none

Joining a GET in flight has one cost: a request that never answers is never answered for ANY of
the callers waiting on it, and the revision poller, which never stacks a second ask on a slow one,
stops noticing changes for the rest of the session. Nothing between the browser and the file
service bounds it either — the images carry no nginx, and a half-open connection after a laptop
sleeps can hang for minutes. So `fget` gives a read `READ_MS` (two minutes, past `/git/status`'s
own 30 s fetch and a first waveform decode) and then drops it with a sentence, freeing the key for
the next caller. `fsend` gets no budget: a write that timed out may still have landed, and a
command may legitimately run long; saying "failed" about a write that happened is worse than
waiting on it.

### A broken-off read is asked once more, and never comes from the browser's cache

A read is fetched with `cache: "no-store"`. Every route answers from the files as they are now, and
the workspace's revision is what decides when to ask again, so a copy the browser revalidated on its
own could only be older than the one asked for. A read whose connection broke, or that came back 2xx
with an empty body, is asked a second time before anyone is told. The file service restarts while
it is being developed, and the file hub breaks the connection rather than ending it cleanly when the
service goes away mid-answer (`packages/file-hub/index.ts`). A clean end would pass a cut-off body as
a whole one, and every caller would fail to parse it.

### A frozen document is refused in ONE place

`FileCfg.frozen` is the whole of read-only mode, and that is deliberate. `fsend` is the only way
anything in these apps writes — around twenty-five call sites in `project.ts` alone — so throwing
`ReadOnlyDocument` there refuses everywhere, once, with a sentence, instead of neutering feature by
feature and meeting the twenty-sixth one in production. Hiding buttons was never the alternative: a
hidden button is still a keyboard shortcut, a command bar entry and a context menu away.
`ReadOnlyDocument` has its own type so a caller can tell "this cannot be done here" from "the
service refused", which as plain `Error`s read the same.

`frozen.canned` answers the routes a snapshot HAS no answer for. A share carries the three compiled
documents and nothing else — no `/tree`, no `/hints`, no `/git/status` — and without canned bodies
every hook that asks for one would draw an error banner about a service that is not merely down but
absent by design. The values are JSON **text** and not objects, for `fget`'s reason above: several
components parse the same body and must not be handed one object to alias. A canned answer
short-circuits before the request and is parsed per caller exactly as a real body is, so a
component cannot tell which kind it got. See `apps/k7/backend/docs/media/shares.md`.

### Blocked or unreachable

A refused CORS preflight and a dead server are the SAME rejection in JS: an opaque
`TypeError: NetworkError`, with no status and no body, because letting a page read that difference
is precisely what CORS exists to prevent. The difference is the whole of the next action — "allow
this origin on the engine's machine" versus "start the engine".

`mode: "no-cors"` is the way through. It sends a simple GET with no preflight and no ACAO check,
yielding an opaque response nothing can read but whose ARRIVAL proves something answered.

| probe | conclusion |
|---|---|
| resolves | the service is up and refused our origin → `blocked` |
| rejects | nothing is listening at that address → `unreachable` |

Both `fget` and `fsend` carry the HTTP `status` onto the thrown `Error`, for the callers that have
to tell "nothing there" from "it went wrong" — the gate's `missing` screen is the main one. A
status also means the service answered, so the gate runs the origin probe above only when there is
none: a 401 or a 503 is not a refused origin, and saying so sends the reader to the wrong fix.

**A hub ticket lives twelve hours, and a session can outlive it.** With `renewTicket` configured —
k7 passes its access's `freshTicket` when the files are hosted — a 401 asks for a new ticket once,
for every request that met it together, and the request is sent again. A write is safe to resend: a
401 is the hub refusing before the service saw anything.

## The routes, and the ones that surprise

**Two route tables, split by what their TYPES reach.** `files.ts` (`fileRoutes`, exported as
`./files`) holds the routes that need only `@studio/web-protocol`: opening a project, the bench, the
tree and its files. The gate runs on it, and an app that only opens a project
needs nothing else. `project.ts` spreads it and adds the compiled views, the modules, the CLI's
verbs and the undo journal, whose types live in `@studio/song-schema`, `@studio/graph-model` and
`@studio/engine-protocol`. Those three are therefore OPTIONAL peers of this package: an app that
imports `./project` brings them, and an app that does not — one consuming this package from outside
the repository — installs none of them.

`project.ts` is the shared client. k7 spreads it into its own and adds what only it has — timeline,
waveforms, video; an app that needs no more uses it as it stands.

- **`openBench`**: `@banc` in the address routes here. It can be slow the first time — a library
  that is not yet on disk — which is why it has a progress screen rather than being asked for silently
  (`apps/k7/backend/docs/media/banc.md`). It is handed the project part of the address verbatim, because the
  MACHINE is what builds the bench and therefore what decides which address it answers; the
  libraries are the machine's already.
- **`open`** takes the project and nothing else: the server keeps the origin's libraries and
  brings them up to date on the way (`packages/file-service/docs/libraries.md`). Its answer also
  carries the change token as of the open, kept for `openedRevision()`. A page polling `/revision`
  starts from it: otherwise its token begins at null, and the first poll's answer looks like a
  change, so every view that fetched on mounting fetched again. On a phone that was the project
  compiled a second time. If a service is too old to send the token, `openedRevision()` returns
  null and the page behaves as before.
- **`moduleLibraries` and `libraryChains`** sit beside `/tree` because that one is the SONG and
  these are outside it. A chain's `path` comes from the service rather than being built by the
  caller, exactly as a module library's does.
- **`sendEngineProject`** plays a document this browser built — the turntables surface's decks
  filled into the project's own compile. It goes through the file service rather than out of the
  app's socket so that ONE thing writes to the engine: the service already loads k7's project
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
- **`historyState`** enables the undo shortcuts. `confirm` applies a process step (restoring a
  bounced file); without it, a process step comes back `needsConfirm` for the client to gate.

### `command`, and the three optional fields in its reply

`want` is what a caller says when it will NOT draw a picture. `CommandWant` is a union of one, and
deliberately a list rather than a boolean: the question is "which of the pictures will I draw", so
the next expensive document to arrive is a member rather than a second flag beside the first.

`graph` comes back ONLY when the command changed the project AND the caller asked for it — the
service builds it once inside that request rather than making the caller fetch it. Building it is
~62 ms on a real song, on the one thread the service has, and k7 runs mute/solo/faders through a
path that never refetches the graph, so that whole class of gesture would otherwise pay for a
document nobody reads. Omit the option and the graph comes back anyway; pass `want: []` to say no.

`rev` does NOT depend on `want`: every writing command answers with the token it produced, which is
what lets a client stop re-asking what the reply already said.

`refused` is the same shape of fact about the other half — the command was understood and declined,
and the lines in `output` say why. Present only when true, so a surface that ignores it reads a
refusal as an ordinary reply (see `packages/commands/docs/refusal.md`).

`changed` names the FILES it wrote, project-relative, out of the journal's own diff. It is what
lets a host reload only what depends on them; absent means the service could not say, which is
"re-ask everything" and never "nothing moved".

`at` points the verbs at a folder OTHER than the open project — the chains builder's template. It
is always a path the caller was GIVEN, by `libraryChains`, and never one it built.

`journal` says how the command's writes are undone when not as a step of their own. `join` folds
them into the step on top: a gesture the shell has to spell as two commands — a module picked on a
cable is `node new`, then the `node insert` that splices it — is still one Ctrl+Z. `skip` keeps
them out of the journal: a write the app made on its own, like the graph pinning its layout, is no
step for Ctrl+Z to take back. It is a word rather than a boolean for the same reason `want` is a
list.

## Two things this client deliberately has no route for

- **Cutting stems** is the media library's: the library holds the masters, so it owns the cut and keeps the
  results, and the engine only lends its model over `/process`. This client speaks to ONE machine
  and the media library is not it, so those calls live where the library's other routes do — `mediatek` in
  `apps/k7/frontend/src/api.ts`. See `apps/k7/backend/docs/media/stems.md`.
- **Grouping two interface inputs into one stereo device** is a verb, not a route:
  `system channel type <channel> <mono|stereo>` writes the preference and tells the engine both,
  so it goes down `/command` with every other act
  (`packages/ui-module-builder/docs/inputChannels.md`). Split over two doors it would be one act
  with no name, and the two halves could disagree.

## Asking the media library: the two lookups

`repoLookup.ts` is same-origin — every studio service sits at a fixed path under one origin — so
the session cookie rides along without asking and there is no CORS to arrange. The path is asked of
`serviceUrl` rather than spelled, so where the médiathèque is mounted stays a fact read from one
table and this file never has to know it.

Both errors are raised in the SERVER's words, because the media library is the side that can be specific — an
unknown name, or a name two repositories answer to.

`accountLibraries` answers an EMPTY list with a **200** and not a 404: "none set" is the ordinary
state of a new account, and a status code is the wrong place to keep the difference between that and a service
that is down. Only the second is worth a diagnosis. It is asked before the project is resolved, for
the reason `launch.md` gives at step 0.
