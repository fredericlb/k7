# Rendering for a hosted backend

`POST /render` bounces a compiled `ProjectDoc` to audio on this machine and streams the wav
back. It exists for exactly one caller: z0's backend, which is hosted in a container
and cannot exec anything itself.

## Why a process and not a message

`--render` is a **one-shot CLI mode** — `studio-moteur --render - --out <dir>` — and it
stays one. The live engine holds an ASIO device, and the cost of a second `te::Engine`
appearing beside it is known:

> An ASIO driver is single-client. A remembered device gets reopened by *every* process that
> constructs an engine … the driver then stays wedged, and from that point on every engine
> start blocks **forever, with no output at all**.

`makeOfflineEngine` opens no device, so a render is safe *because it is a separate process
that never touches hardware*. Giving the WebSocket server a `render` verb would put that
second engine inside the process holding the interface, and the safety would rest on a
constructor's argument rather than on process boundaries.

That is also why "the tray runs a render-only engine" is **not** a long-lived process here.
There is nothing to supervise: a render starts, writes, and exits.

## Why the file service and not the engine

The engine speaks WebSocket and knows how to make sound. The file service speaks HTTP,
already knows where this machine's binary is (`findEngineBinary`), already has the
engine-token gate, and is already the surface a non-browser reaches. A hosted backend
sends no `Origin`, so CORS allows it outright — the token is what makes the call
deliberate.

## The shape of the route

One request, one file, no job id. A render of an z0 clip takes seconds and the caller
is a server: a polling protocol would be machinery in front of a wait shorter than the poll
interval. `--stems` is deliberately not offered here — N files need a job to hold them.

Stem **separation** does need exactly that, and has its own route — `POST /separate`,
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

## z0's side, and why it is the exception

`apps/z0/backend/src/render.ts` picks the machine from **`Z0_RENDER_ENGINE`**, an
environment variable holding that machine's file-service base URL.

Configured, not chosen, and not per user. Every other service in studio asks a person which
engine they drive, because a person is sitting at an interface. A render has no audience:
which machine does it is a deployment fact, and asking a player would be asking them about
someone else's hardware.
