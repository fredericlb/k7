# The server's engine and machine jobs

Most engines run on a musician's machine. Two things on this page are different: the engine a k7 server runs for itself, and the work a server asks of the machine your project plays on.

## The server's own engine

A k7 server can run an engine of its own, beside the web app. It is an ordinary engine with its supervisor, listed at the server like any musician's machine, under the name the server's administrator gave it (by default **k7 server**). It has no sound card: it plays into a silent virtual output that keeps real time.

### Hearing it

Because nobody can hear the server's speakers, the server's engine tells every page that drives it to play its sound **in the browser**. The engine streams its master output to the page, and you hear it through your browser's audio. You can pick the server's engine in the engine picker like any other; expect a latency in the Q2 or Q3 band, since the sound crosses the network.

### Shares

A published share, a link to a project at a checkpoint, plays on the server's engine. Each visitor gets a session of their own, so two people listening to the same link do not hear each other's play or stop. A visitor can play, stop, rewind and mute or solo tracks, and nothing else: no recording, no plugin access, no editing.

Limits on a share's player:

| Limit | Message the visitor sees |
|---|---|
| The server has no engine of its own | *this server has no engine of its own to play shares on* |
| The server's engine is momentarily disconnected | *the server's engine is not connected right now — try again in a moment* |
| Eight visitors at once across all shares | *too many people are listening right now — try again soon* |
| Two visits at once from the same address | *this share is already open from here* |
| A visit lasts at most three hours | the player closes |

Publishing a share is described in the getting-started section of this guide.

### Renders

Some commands bounce audio offline: freezing a track, splitting, consolidating, processing a clip through a chain, a mixdown, or a share with stems. A bounce runs through an engine binary. The server picks, in this order: an engine binary installed beside the server's file service, then the machine of the engine your project is bound to, then the server's own engine. The finished files are copied back into your workspace. A render that takes longer than ten minutes on a remote machine is abandoned. Rendering a video's picture is a different job, done by the server itself rather than by an engine; see the picture section of this guide.

### For administrators

The server's engine is the `engine` service of the deployment. It reads:

| Setting | Default | Meaning |
|---|---|---|
| `ENGINE_REGISTRY_URL` | `http://k7:8789` | Where it reaches k7's engine list, on the internal network |
| `ENGINE_NAME` | `k7 server` | The name pickers show |
| `ENGINE_INSTRUMENTS` | `all` | Which sampled instruments it downloads; it has no Downloads page to choose them in |
| `RENDER_KEY` | none | A secret shared with k7. The engine presents it on its tunnel, and only an engine holding the same key becomes the server's render and share machine. Without it, shares do not play. |

Its state (identity, downloaded instruments, project copies) lives in the `engine-home` volume. An `engine.json` config file is created there, empty, on first start; any key from [the command-line engine's config](./81-command-line-engine.md#every-key) can go in it.

## Jobs a server asks of your machine

When you open a project, k7 binds it to one engine. Some work happens on that engine's **machine** rather than on the server, because it needs that machine's disk, CPU or GPU. The server asks the machine's supervisor through its tunnel, and files cross the tunnel as needed. You do not start these jobs by hand; the commands and buttons that need them do.

| Job | When it runs | What happens |
|---|---|---|
| **Stem separation** | Splitting a song into stems from a playlist, a desk, or a chain that separates | The machine decodes the song and runs the separation model on its own CPU or GPU, then writes the stems as 24-bit WAV files, which travel back. Asking for the same cut twice joins the job already running. |
| **Set list prefetch** | Every minute, while projects are open | The songs your open projects name in the media library are copied onto the machine ahead of time, so a set list's songs are on its disk before the gig, even if the venue has no network. A list that has not changed is not asked again. |
| **A media library song for the player** | When a page asks an engine to play a song from the media library | The song is copied down to the machine, and the engine is given the local path. |
| **Render** | A bounce, as above | The machine runs its engine binary offline on the compiled project and sends back the mix (and stems when asked). |
| **Undo audio** | Undoing an edit whose audio only this machine kept | The machine sends its copy back to the server. A machine keeps such audio for a month after its last use, then deletes it. |
| **The log** | The editor's **Logs** panel | The panel shows the engine machine's log, read through the tunnel. |

### Choosing what separation runs on

Stem separation runs on the CPU unless the machine is told otherwise. From the command bar, with a project open on that machine:

```text
system onnx dml,cpu
```

Providers are tried in order: `cpu`, `dml` (DirectML on Windows), `cuda`, `coreml`. An empty list goes back to the CPU. The choice is stored on the machine itself. (A command-line engine keeps it only until it stops; put `onnxProviders` in its config file to keep it.)
Two related commands choose which chain does the separating, for every surface that can start one:

| Command | What it stores |
|---|---|
| `system stems @k7-core/stems` | The chain that separates a record into stems |
| `system instrumental @k7-core/instrumental` | The chain that gives a record without its voice |

An empty reference clears either one.
