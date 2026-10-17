# Who renders, and how

Every bounce the file service makes — an export, a share, a k7 publish, and the verbs that write
audio (freeze, consolidate, process) — goes through `renderProject` (`src/render.ts`) and
the one choice of machine behind it, `serviceRenderer` (`src/renderers.ts`).

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

## This machine, else an engine's machine

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

A base folder is refused on a machine. It names a folder on the disk the engine runs on, and the
server cannot know what a remote machine has there.

## The scratch directory

`renderProject` owns its temp directory until it succeeds, and removes it on **every** failure: a
wedged machine renders repeatedly, and each attempt costs a song's worth of disk. On success the
directory is the caller's to delete.

## Two failures that must not look alike

- **No engine to render with.** A real state, said out loud, because "render failed" with no
  reason reads as a broken document.
- **Exit 0 with nothing written.** The shape a silent failure takes — a document whose every
  track was filtered out. It is an error, not a successful empty render.

Both are a `RenderError` carrying the sentence, so a caller can tell a diagnosis from a crash.
