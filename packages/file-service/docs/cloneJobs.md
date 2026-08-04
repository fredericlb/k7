# The clone is the one thing worth a job id

`POST /workspaces/clone` starts a clone and answers immediately with a job; the caller polls
`GET /workspaces/clone/:id` until `done`. This is the first job registry in the file service,
and it contradicts something written elsewhere in this package, so it is worth saying why
both are right.

`routes/render.ts` argues against exactly this shape:

> ONE request, one file, no job id. A render of a song takes seconds and the caller is a
> server, not a browser — a polling protocol would be machinery in front of a wait that is
> shorter than the poll interval.

Every clause of that is about a render, and every clause of it fails for a clone:

| | render | clone |
|---|---|---|
| how long | seconds | tens of seconds, and `git clone` here is capped at **120 s** |
| who waits | a server | a **person**, watching a blank screen in l8 |
| what it produces | one file, streamable | a directory, and there is nothing to stream |
| what it says while it runs | nothing | `Receiving objects: 47% (470/1000)` |

The last row is the real argument. git already knows how far along it is and will say so; a
request that holds the socket open throws that away and shows a spinner instead. That was the
old behaviour — `WorkspaceGate` had a boolean `cloning` flag and nothing else — and it was
acceptable only while cloning was a rare, deliberate act on the workspace picker. Now it is
what happens when you open a project from st0, so it is on the path everyone walks.

## The shape

The service already had a "start it, then poll" pattern and this copies it rather than
inventing a second one: `waveformOps.ts` (`POST /waveforms/prewarm` + `GET /waveforms/status`),
polled by `useWarmWaveforms` in l8. Two things are different here.

**It needs an id.** Waveform status is implicitly scoped to a `Workspace` instance, because
there always is one. A clone is precisely the case where there is not yet a workspace to hang
the state off, so the job is keyed by `(user, workspace name)` — hashed, so the id carries
nothing about either.

Keying on the work rather than on a counter buys idempotence for free: two tabs, a retry, or
a remount asking for the same clone **join the job in flight** instead of starting a second
`git clone` into the same directory. That matters because the second one would fail with
"workspace already exists" while the first was still running, which reads like a bug.

**It keeps the output.** git's progress arrives on stderr with `\r` between updates — it
rewrites one line in place rather than emitting new ones — so the reader splits on `\r` as
well as `\n`. The last fifty lines are kept, because a failure here is usually something the
person must fix at their git host (`Permission denied (publickey)`, `Host key verification
failed`) and summarising that helps nobody. The same reasoning as the old synchronous route,
which already returned git's stderr verbatim.

## Lifetimes

A finished job stays readable for five minutes, then is swept. Long enough for a poller to
see how it ended, short enough that a long-lived service does not accumulate them. A poll for
a job that has been swept gets **404**, not a synthetic "done": a job this service has
forgotten cannot be waited on, and saying so lets the caller re-ask the question it actually
cares about — `GET /workspaces/by-repo`, which reads the disk.

## Why `--progress`

git writes counters only when it believes it is talking to a terminal. Under `spawn` it is
not, so without `--progress` stderr carries the beginning and the end and nothing in between.
