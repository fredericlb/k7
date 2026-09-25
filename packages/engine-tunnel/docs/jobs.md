# Jobs — asking the engine's MACHINE to do something

Some work belongs to the machine an engine runs on, not to the server: cutting stems runs its
model on that machine's CPU or GPU, a playlist is written onto the stick plugged into it. The
server asks for it on a **jobs channel**: a tunnel channel opened with `kind: "jobs"`, which the
supervisor's agent answers itself instead of piping to the engine. There is no file service on
the engine's machine to ask.

## One request, its replies, the last one settling it

A request is one JSON frame, `{ type, id, … }`; the machine answers with as many frames carrying
the same `id` as it has news, and the caller decides which one is the last (`requestJob`,
`jobsClient.ts`). A `type: "error"` reply ends it. A request is started once its files are on the
machine and **not awaited**: a separation takes minutes, and the next request on the channel must
not wait behind it.

What a machine does is registered by type (`TunnelAgentOptions.jobs`); the supervisor's list is
`packages/engine-host/src/machineJobs.ts`. A type it does not know is refused by name.

## The files travel as they do for the engine

A jobs channel is opened with the same **roots** an engine channel is, and its frames cross the
same path map (`tunnel.md`): a file a request names is downloaded before the handler sees the
request, and a file a reply names, written under a writable root, is uploaded before the caller
sees the reply. So a handler works on local paths only, and a caller on server paths only — a
separation's source and model arrive on the machine, and its stems land where the server asked.

Two exceptions, both explicit. A request that names too many files to fetch before it starts — a
set list of thirty songs — brings each down when it gets to it (`JobContext.fetch`), so it can
report as it goes. And a reply's **`raw`** field crosses unmapped: the one caller that needs the
machine's own spelling of a path is a browser about to hand that path to the engine (`local`, the
song a player is about to play).

Who may open one is who may open any channel: a process holding the tunnel hub, or one given a
bound loopback path by it (`TunnelHub.bindLocal(…, "jobs")`).
