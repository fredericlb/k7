# Answering for pl8 when there is no pl8

## The one rule

**Every route under `/pl8` answers.** Not "answers correctly when it can" — answers, always,
with JSON and a status the caller already knows how to read.

The reason is a specific screen. `project-shell`'s gate catches an unexpected throw by running
`diagnoseFileService`, and `docs/fileApi.md` explains why that probe can only ever say one
thing about a service which is up: a refused CORS preflight and a dead server are the SAME
rejection in JS, so the probe distinguishes them by whether an opaque request *arrives*. It
arrives. So the verdict is `blocked`, and the user gets *"this page isn't allowed to reach the
engine"* with a CORS story in a code block — on a machine where nothing whatsoever is wrong.
`launch.md` calls it the worst screen in the app.

A route that fails is therefore not a smaller version of a route that says no. It is a
different and much worse outcome.

## It is the origin's job, not the client's

`fileApi.ts` already has a mechanism for answering routes with no server behind them —
`frozen.canned`, which `SharedGate` uses to open a published snapshot. This is the same *idea*
lifted one layer up, from the client to the origin.

It is deliberately **not** `FileCfg.frozen` itself. That flag makes `fsend` throw
`ReadOnlyDocument` on every write, and offline is not read-only: the whole point is that a song
on this machine is fully editable. Reaching for `frozen` here is the tempting wrong reuse.

## The answers, and why each is that answer

| route | answer | why |
|---|---|---|
| `GET /projects` | `200 {repos: [], revision: "offline"}` | An EMPTY register is what makes the home page address its projects as `@local`: `namedByRepo` needs the repo name to be registered, and none is. |
| `GET /projects/revision` | `200 {revision: "offline"}` | Constant on purpose — `Home` refetches when it MOVES, so a changing value would re-ask an empty register forever. |
| `GET /projects/libraries` | `200 {libraries: null}` | The **designed** null. "No library repository" is the ordinary state of a new account and the gate has a screen for it with no Retry. A 404 would read as "pl8 is broken". |
| `GET /projects/by-name/:n` | `404` **with a sentence** | 400 and 404 are what the gate turns into its `missing` screen, whose one button goes back to the home page — the right move when there is no register to resolve against. It prints the server's own words, so the sentence is the message. |
| `GET /projects/ssh-key` | `200 {publicKey: null}` | A value, not a failure. The key belongs to the account, and the account lives on pl8. |
| `GET /shares`, `/shares/revision` | `200 {shares: [], revision: "offline"}` | As above. |
| anything else under `/pl8` | `503` with a sentence | See below. |

Writes are **refused, never faked**. The register is pl8's; a local mirror of it would be the
second copy `apps/pl8/docs/projects.md` argues against, and the two would drift the moment a
server appeared.

## The catch-all is what makes the rule true

A list of routes is a list of the routes somebody thought of. The `app.all(/^\/pl8/)` at the
bottom is what turns "every route answers" from an aspiration into a property: a route pl8
grows later, or one simply missed here, still gets JSON and a 503 instead of falling through to
the SPA catch-all and handing `index.html` to a `fetch` that will call `.json()` on it.

`503` rather than `404`: the route exists. The server for it does not.

## What comes next

Lot C puts the remote proxy **in front** of this, for loopback callers with a paired server.
The shim then becomes the answer for the offline case and for the LAN — a second device must
never ride the account credential, which is `origin.ts`'s job.
