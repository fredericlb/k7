# The machine, and what it answers

The second half of `types.ts` is not about a song. It is about *where* a song is: which
workspaces a machine holds, what an engine is currently serving, and the numbers that decide
whether a browser can reach one at all. This page holds the reasoning; the type file keeps the
names.

## The machine answers what it holds

**The machine** — the account's file service — answers what is INSIDE a workspace:
`AccountWorkspace`, from the working copy it actually holds. Nothing else does. A hosted mirror
answering the same question from the other side would be a second copy of what the working copy
already has, and a worse one — a fetch behind, and blind to a project that is committed but not
yet pushed. No service keeps a register of repositories either (`apps/pl8/docs/projects.md`). See
`apps/st0/frontend/docs/projects.md`.

`origin` is `remote.origin.url` as git wrote it, normalized, and null for a workspace that is not
a clone at all. `repoName` is its last path segment without `.git`, derived here because deriving
it costs nothing the `origin` has not already paid for; it is what a person reads on the row, and
never what addresses the workspace — that is its folder name, under `@local`
(`packages/web-protocol/docs/addresses.md`). The URI itself never reaches the address bar, because
it carries a host, a port and a user, none of which belong in a bookmark.

`uniqueName: false` says two workspaces on this machine have origins ending in the same short name
— worth saying on the rows, since the name alone would not tell them apart.

## `active` is not the same as `served`

`SurfacedProject` is one project on this machine that declares at least one surface, with those
surfaces. Its identity fields are `AccountWorkspace`'s, repeated per project rather than nested,
because the list is read as a flat one: the caller is looking for a SURFACE and the workspace it
lives in is a detail of the address. `path` is workspace-relative, `.` for a lone-project clone.

`active` is the workspace's `.studio-active` marker — the project this workspace currently has
open. One per workspace at a time, which is why it is a flag and not a filter: a caller that wants
only the live ones can say so, and one showing a menu wants to know which row is already up. See
`apps/st0/frontend/docs/external.md`.

`ServedProject` (GET `/engine/served`) answers a different question, and the difference is the
point. `active` is a per-workspace marker written by whoever opened last; this is the file
service's note of what it SENT, one project for the whole account, because a session is per
service and per person (`packages/engine-protocol/docs/sessions.md`). A machine with three markers
is still an engine holding one song. `workspace` + `path` rather than an absolute path: those are
the two strings every address on this side is built from, and the engine's disk layout is nobody
else's business.

`SurfacedProjectList` is not `ProjectSurfaces`, which is `@studio/song`'s — that one is ONE
project's surfaces with the diagnostics from reading them, and this is the machine's list of the
projects that have any. Projects declaring none are absent rather than present and empty.

## Jobs: clone, and separation

`CloneJob` and `SeparateJob` are the same shape — start, poll, 404 when swept — with one field the
first has no use for. A clone's product is a DIRECTORY, named by `workspace`, so there is nothing
to list. A separation's product is four files, and the caller needs their paths: they are what it
came for, and they are not derivable from the request, since the stems' names come from the model.
See `packages/file-service/docs/cloneJobs.md`.

`StemsReply` is what `POST /stems` answers — the desk asking for ONE record to be prepared. Two
fields rather than one job, because a record already separated must start nothing: the desk asks
on every load, and the scan flag it asks WITH is a snapshot taken minutes ago. So `ready` is the
state of the disk, and `job` is only there when there is work to do. Encoding the first as a job
that is instantly done would hand the caller an id nobody can poll.

## Shares are the author's view

`ShareSummary` is one frozen snapshot a person has shared, as their own Projets section lists
them. The AUTHOR's view and nobody else's: `origin` names a repository and a folder on the machine
it came from, and the public routes serve none of this — they serve the snapshot's manifest.

`token` rides along in the clear because it IS the copy-link button. It is blanked on revocation, so a
revoked row cannot be copied back out of the screen it is still drawn on, and the row SURVIVES
dated by `revokedAt`: a share that vanished would leave a doubt.

## Module libraries: absent is not the same as empty

`ModuleLibrary` gets its own answer beside the file tree, because the tree is the SONG and these
are outside it: the workspace's `_modules` sits beside the project, and the account's libraries
are not in the workspace at all (`_libraries/<name>/…` is a virtual folder). Ordered by precedence, nearest first, by whoever answers.

`exists: false` with no nodes is a real state and not an absence: a level you *could* put a module
in is worth drawing, so somebody can. Distinguishing it from an empty one matters because only one
of the two is fixed by adding a module.

`readOnly` is true for `@engine` and only for it. A scanned plugin is a module the engine merely
REPORTS: it has no folder, so there is nothing to write into and nothing to open — the rows are a
vocabulary you can name in a chain, not files. Giving one a folder is `module own <ref>`, which is
a different act; see `packages/song/docs/moduleFork.md`.

## Reaching an engine, and staying reached

The browser talks to the file service directly, cross-origin, with no OIDC cookie there, so it
passes identity, context and a light gate as the three `*_HEADER` constants.

**"Assigned" is a LEASE.** A closed tab can only say goodbye best-effort, so the truth has to
expire on its own: the driving tab renews with an idempotent re-POST of `/api/engine/select` every
`ENGINE_ASSIGN_RENEW_MS`, and no renewal for `ENGINE_ASSIGN_TTL_MS` lapses it. Per-engine across
users.

**One budget covers both halves of reaching one.** The browser measures addresses in PARALLEL, so
it spends `ENGINE_REACH_BUDGET_MS` once; the relay dials them in SEQUENCE, so without a shared
deadline it spends that budget PER address and is called unreachable while the engine answers.
Both stop at the same wall clock, and `ENGINE_DIAL_TIMEOUT_MS` caps what one address may eat
of it so a first dead address cannot spend the lot. See `packages/engine-registry/docs/proxy.md`
and `packages/engine-browser/docs/access.md`.

**A half-open socket never fires `close`.** A wedged relay, a lapsed NAT, a laptop back from sleep
— nothing reconnects and sends go nowhere. The engine has no server-side ping (IXWebSocket ships
`kPingIntervalSeconds(-1)`), so the client is what has to ask: nothing inbound for
`ENGINE_IDLE_PING_MS` triggers a `whoami`, the one verb the engine always answers, and no reply
within `ENGINE_PONG_TIMEOUT_MS` means the socket is dead however open it claims to be. Reconnect
backoff doubles from `ENGINE_RECONNECT_MIN_MS`, jittered, resets on a connection that opened, and
never exceeds `ENGINE_RECONNECT_MAX_MS` so a forgotten tab stops hammering the relay.

**The outbox covers a blink, and only a blink.** Unbounded, it turns a ten-minute outage into a
burst of stale transport verbs delivered all at once on reconnect. `ENGINE_OUTBOX_MAX` caps it,
oldest sent first, and `ENGINE_OUTBOX_TTL_MS` drops what nobody is waiting for any more.

**The registry** is where an engine registers itself, via the supervisor, with the addresses of
`EngineAddresses`. The browser MEASURES them all at once (`packages/engine-browser/src/probe.ts`)
and picks the fastest of the unassigned ones.

`PublicEngine` never carries the secret token. It does carry `heldBy`/`heldProject`, because
"busy" and "busy with Fred's winter.st0" are not the same screen: an engine that reads simply
unavailable is one people retry, and taking a project over is a thing you should only do knowing
whose it is. `proxyTicket` is a short-lived pass for the relay at `<base>/api/engine/<id>/ws`,
which is how a browser reaches an engine it may not dial directly (an HTTPS page and a `ws://` LAN
address); it is optional because the REGISTRY does not mint it — the `/engines` route does, being
the authenticated one. See `packages/engine-registry/proxy.ts`.

How good a link is — Q1/Q2/Q3, off a measured latency — is `./quality.md`. Measured, and not a
locality tier, which would rank a gigabit LAN below a laptop running at 2048 frames. How capable
the machine itself is — one integer, 1000 the reference, measured by its supervisor — is
`./performance.md`.
