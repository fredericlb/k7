# Rendering for a hosted backend

`POST /render` bounces a compiled `ProjectDoc` to audio and streams the wav back. It exists for a hosted backend outside this
repository, which runs in a container and cannot exec anything itself.

## Why a process and not a message

`--render` is a **one-shot CLI mode** — `k7-runtime --render - --out <dir>` — and it
stays one. The live engine holds an ASIO device, and the cost of a second `te::Engine`
appearing beside it is known:

> An ASIO driver is single-client. A remembered device gets reopened by *every* process that
> constructs an engine … the driver then stays wedged, and from that point on every engine
> start blocks **forever, with no output at all**.

`makeOfflineEngine` opens no device, so a render is safe *because it is a separate process
that never touches hardware*. Giving the WebSocket server a `render` verb would put that
second engine inside the process holding the interface, and the safety would rest on a
constructor's argument rather than on process boundaries.

That is also why "the supervisor runs a render-only engine" is **not** a long-lived process here.
There is nothing to supervise: a render starts, writes, and exits.

## Why the file service and not the engine

The engine speaks WebSocket and knows how to make sound. The file service speaks HTTP,
already knows where this machine's binary is (`findEngineBinary`), already has the
engine-token gate, and is already the surface a non-browser reaches. A hosted backend
sends no `Origin`, so CORS allows it outright — the token is what makes the call
deliberate.

## Who renders: this machine, else an engine's machine

Every render the service makes — this route, an export, a share, a k7 publish, and the verbs that
write audio (freeze, split, consolidate, process) — goes through ONE choice, `serviceRenderer` in
`src/renderers.ts`:

1. **this machine's engine binary**, when there is one: a desktop, a dev checkout;
2. **the bound engine's machine**, over its jobs path: the account's own engine, its own plugins;
3. **the server's render machine**, over the jobs path the hub binds for the deployment's render
   key (`docs/server-engine.md` at the repo root). A hosted k7 keeps no engine binary, so this is
   what renders when nobody is playing.

A machine that fails hands the render to the next one: a musician's supervisor may predate the
`outDir` form of the job (`packages/engine-tunnel/docs/jobs.md`), and a render must not fail on
it while the server's machine stands by.

A machine writes only under a WRITABLE root, so a remote render lands in the account's render cache
(`.renders/jobs/<id>`) and is copied into the caller's folder — copied, since the cache and a
scratch folder are often on different volumes — then the cache entry goes. The cache folder is
created first: the hub accepts no upload under a root it cannot resolve.

`baseDir` is refused on a machine. It names a folder on the disk the engine runs on, and the
server cannot know what a remote machine has there.

## The shape of the route

One request, one file, no job id. A render of a short clip takes seconds and the caller
is a server: a polling protocol would be machinery in front of a wait shorter than the poll
interval. `--stems` is deliberately not offered here — N files need a job to hold them.

Stem **separation** does need exactly that, and is a job run on an engine's machine,
start-then-poll, see [stemSplit.md](../../stem-separation/docs/stemSplit.md). A render's stems are a different thing:
per-TRACK bounces of a document the caller already has, seconds apart from the one file it
wanted, which is why the one-request shape still fits here.

The temp directory is removed on **every** path including the failures: a wedged machine
renders repeatedly, and each attempt costs a song's worth of disk.

## Two failures that must not look alike

- **No engine binary on this machine.** A real state, said out loud, because "render
  failed" with no reason reads as a broken document.
- **Exit 0 with nothing written.** The shape a silent failure takes — a document whose every
  track was filtered out. It is an error, not a successful empty render.

Both come back as 422 with the sentence; anything else is 500.
