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

A caller waits for a bounded time: 15 minutes without a reply (`JOB_IDLE_MS`), or an hour in all
(`JOB_TIMEOUT_MS`), each overridable per call. Either ends the request with a `JobError` and closes
the channel, so a machine that went quiet holds no server-side promise, and no channel, for ever. The
idle bound is long because a `render` says `rendering` once and nothing more until its files are up.

A caller holding no channel of its own — the hosted file service, which reaches the bound machine
at a loopback path — asks through `requestJobAt`: a socket per request, closed once it settles. A
request is rare and long, so a pooled socket would buy nothing and would have to survive the
machine's restarts.

What a machine does is registered by type; the supervisor's list is
`engine/k7-supervisor/src/MachineJobs.cpp` (`TunnelAgentOptions.jobs` for the TypeScript reference
agent the server's tests run on). A type it does not know is refused by name.

`render` bounces a whole ProjectDoc, sent inline, with the machine's own `k7-runtime --render`. Its
clip paths are strings under a shared root like any other, so they are downloaded before the handler
runs. It comes in two shapes:

- `{ doc, out }`, the mix alone to one server path, answered `{ type: "rendered", file: out }`. The
  automatic VST freeze sends it (`packages/song/docs/autoFreeze.md`), since only that machine has
  the plugins.
- `{ doc, outDir, stems }`, every file of the manifest into a server folder, answered
  `{ type: "rendered", mix, stems: [{ name, file }] }` with every file named whole. Any render a
  file service cannot make itself sends this one (`packages/file-service/docs/renderers.md`).

In both, the paths answered are under a writable root, so naming them is what uploads them.

## The server's render machine

A hosted k7 keeps no engine binary, so it needs a machine that renders when nobody's engine is
bound: its own `engine` service (`docs/server-engine.md` at the repo root). That machine is told
apart by a **render key**, a secret the deployment gives both sides (`STUDIO_RENDER_KEY`). The
supervisor sends it in a header beside its token when it dials the tunnel, and the hub marks that
tunnel as the render machine. `TunnelHub.bindRenderer` hands out a jobs path that resolves to
whichever tunnel holds the key when a client CONNECTS, so the path each file service is given at
start outlives the machine's restarts.

The engine's token cannot play this part. It proves an engine is the one that registered under its
id, and `whoami` hands it to every socket that drives the engine (`packages/engine-registry/docs/token.md`).
Anyone who once played on the server's engine could then announce themselves as it and receive
every account's renders. The render key is never sent to a browser. A tunnel that offers a WRONG
key is refused outright rather than treated as an ordinary engine, so a misconfigured render
machine says so in its log instead of silently rendering nothing.

The registry's engine list marks that machine `server` (`TunnelHub.isRenderer`) for as long as its
last tunnel presented the key, up or down: a drop must not leave it unowned, since any account holds
its token and could otherwise enrol it (`packages/engine-registry/docs/ownership.md`). It is the one
engine reached only through the server that a browser may take without a click: the render key is
a proof no stranger's heartbeat can make (`packages/engine-browser/docs/access.md`, "Who is taken
unasked").

`prefetch` and `send-up` are how the machine KEEPS an undo's audio (`packages/file-service/docs/history.md`):
`prefetch` names files the channel brings down before it answers, with how many are there; `send-up`
names one the server no longer has, and the machine answers `{ type: "sent", file }` naming its own
copy, freshly stamped — the stamp is what makes the channel upload a file it last brought down.

## The files travel as they do for the engine

A jobs channel is opened with the same **roots** an engine channel is, and its frames cross the
same path map (`tunnel.md`): a file a request names is downloaded before the handler sees the
request, and a file a reply names, written under a writable root, is uploaded before the caller
sees the reply. So a handler works on local paths only, and a caller on server paths only — a
separation's source and model arrive on the machine, and its stems land where the server asked.

`sync` is the one request the AGENT answers rather than the machine's list, since copying is the
tunnel's own business: its files are NOT brought down before it starts, it copies them itself and
reports each one (`tunnel.md`, `packages/file-service/docs/engineSync.md`).

Two exceptions, both explicit. A request that names too many files to fetch before it starts — a
set list of thirty songs — brings each down when it gets to it (`JobContext.fetch`), so it can
report as it goes. And a reply's **`raw`** field crosses unmapped: the one caller that needs the
machine's own spelling of a path is a browser about to hand that path to the engine (`local`, the
song a player is about to play).

Who may open one is who may open any channel: a process holding the tunnel hub, or one given a
bound loopback path by it (`TunnelHub.bindLocal(…, "jobs")`).
