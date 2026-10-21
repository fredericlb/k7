# The command-line engine

The command-line engine is the engine and its supervisor with no window. Use it on a studio computer you drive from a browser elsewhere, on a machine you do not want to install the [tray](./82-desktop-app.md) on, or on a small headless box next to your audio interface. You configure it with one JSON file.

The tray runs this same engine, in the same `~/.k7` folder and on the same port: run one or the other on a computer, not both.

For what the engine and supervisor are, see [Engines](./80-engines.md).

## Get it

The command-line engine ships as one archive per platform:

| Platform | Archive |
|---|---|
| Windows | `k7-runtime_<stamp>_windows-x64.zip` |
| macOS | `k7-runtime_<stamp>_macos-arm64.tar.gz` (or `-x64`) |
| Linux | `k7-runtime_<stamp>_linux-x64.tar.gz` |

Unpack it anywhere. It contains one folder, `k7-runtime/`, with:

| File | What it is |
|---|---|
| `k7-supervisor` (`.exe` on Windows) | The program you run |
| `k7-runtime` (`.exe` on Windows) | The engine; the supervisor finds it beside itself |
| `faust-libs/` | Libraries the engine needs for Faust modules |
| ONNX Runtime libraries | What stem separation runs on. Without them the machine cannot cut stems, but everything else works. |
| `engine.json` | An example configuration |

The binaries are not signed. macOS and Windows may warn the first time you run them.

## Run it

```sh
cd k7-runtime
./k7-supervisor --config engine.json
```

On Windows:

```bat
k7-supervisor.exe --config engine.json
```

To keep the engine on one port whatever else runs on the machine, for a firewall rule or an address you wrote down, add `--port`:

```sh
./k7-supervisor --config engine.json --port 8765
```

The supervisor reads the file, starts the engine, lists it at the studios you named, and runs until you press Ctrl-C (or the process receives SIGTERM or SIGHUP). On stop it first removes the engine from every studio's list, then stops the engine. It prints `[host] running from the config file; Ctrl-C to stop` once it is up.

Before the engine starts, the supervisor measures the machine for about a second (CPU speed, cores, disk, memory). The resulting performance score is what the engine pickers show.

## The config file

The config file is a JSON object. Every key is optional. A key with a wrong type is ignored on its own and the others still apply. The example that ships with the archive is:

```json
{
  "registryUrls": ["https://app.k7.rocks"],
  "port": 8765,
  "audioPriority": [],
  "instruments": ["all"],
  "machineName": ""
}
```

### Every key

| Key | Type | Default | What it does |
|---|---|---|---|
| `registryUrls` | array of strings | none | The studios this engine is listed at. Give any address of the studio: `https://app.k7.rocks`, `app.k7.rocks` and `https://docs.k7.rocks` all mean the same studio, and so do the former addresses `https://st0.app`, `https://play.st0.app` and `https://k7.st0.app`. A bare host gets `https://`. Duplicates are dropped. When the list is empty, the engine is listed nowhere (see `STUDIO_REGISTRY_URL` below). |
| `registryUrl` | string | none | One studio, as a single string. Read only when `registryUrls` is missing or empty. |
| `port` | integer, 1 to 65535 | `8765` | The first port the engine tries. When another program already holds it, the engine takes the next free one, up to nine ports further, and the log names the program in the way. Studios learn the port the engine actually took, so browsers find it either way. With `--port` on the command line, the engine uses that port or does not start. |
| `audioPriority` | array of strings | empty | Audio interface names, best first. The engine uses the first one that is plugged in. See [Audio interfaces, MIDI and plugins](./84-audio-midi-plugins.md). |
| `audioDevice`, `audioFallback` | strings | none | One preferred interface and one fallback. Read only when `audioPriority` is missing or empty; they become a two-line `audioPriority`. |
| `instruments` | array of strings | see below | The sampled instruments this machine keeps. Names come from the table in [Engines](./80-engines.md#sampled-instruments). The word `"all"` anywhere in the list keeps every instrument. Missing instruments are downloaded when the supervisor starts. |
| `onnxProviders` | array of strings | empty (CPU) | What stem separation runs on, in order of preference: `cpu`, `dml` (DirectML, Windows), `cuda`, `coreml`. Names are lowercased and duplicates dropped. Empty means the CPU. |
| `machineName` | string | the computer's host name | The name engine pickers show for this machine. |
| `extraCaCerts` | string (file path) | none | A PEM file of extra certificate authorities to trust. Use it when your studio's HTTPS certificate is signed by your own CA. The supervisor already trusts the operating system's certificates. |
| `renderKey` | string | none | A key shared with the k7 server. An engine that presents it becomes that server's render machine. Only the server's own engine needs this; see [The server's engine and machine jobs](./86-server-engine-and-jobs.md). |

If `instruments` is not in the file at all, the supervisor keeps whatever instruments are already on the machine and downloads nothing new.

The supervisor never writes to your config file. Something changed at run time, for example a provider list sent by a studio's `system onnx` command, lasts only until the supervisor stops. Edit the file to make it permanent.

### Examples

An engine listed at two studios, preferring an RME interface and falling back to the built-in output:

```json
{
  "registryUrls": ["https://app.k7.rocks", "https://studio.example.org"],
  "audioPriority": ["Fireface UCX II", "MacBook Pro Speakers"],
  "machineName": "Studio Mac"
}
```

A Windows machine that separates stems on its GPU and keeps two instruments:

```json
{
  "registryUrls": ["app.k7.rocks"],
  "onnxProviders": ["dml", "cpu"],
  "instruments": ["salamander-grand-piano", "naked-drums"]
}
```

## Environment variables

The supervisor also reads these. A key in the config file wins over the matching variable.

| Variable | What it does |
|---|---|
| `STUDIO_HOME` | The state folder. Default: `~/.k7` (`%USERPROFILE%\.k7` on Windows). |
| `STUDIO_REGISTRY_URL` | Studios as a comma-separated list, used when the config file names none. |
| `STUDIO_MACHINE_NAME` | Same as `machineName`. |
| `STUDIO_EXTRA_CA_CERTS` | Same as `extraCaCerts`. |
| `STUDIO_INSTRUMENTS` | `all` keeps every instrument. |
| `STUDIO_RENDER_KEY` | Same as `renderKey`. |
| `STUDIO_ONNX_PROVIDERS` | A provider list (comma or space separated) that overrides `onnxProviders` for separations. |
| `STUDIO_ENGINE` | The path of an engine binary to run instead of the one beside the supervisor. |
| `STUDIO_PORTS` | `k7=<port>`: the port of a studio running on this same machine, when it is not 8789. |
| `STUDIO_ENGINE_ROOTS` | Extra folders the engine may read and write files in, separated by `:` (`;` on Windows). The engine refuses any file a project names outside its state folder, these folders and the system temp folder (temp is read-only for it), and never opens a network share path. Projects from a studio are copied into the state folder, so you need this only for files you point at directly. |

## The state folder

Everything the supervisor and engine write goes into the state folder (`~/.k7` unless `STUDIO_HOME` says otherwise):

| File or folder | What it holds |
|---|---|
| `engine-id.json` | The engine's identity: a permanent id, a token, and a secret only the supervisor sends to studios. It is created on first run, readable by your user alone, and keeps the engine recognisable across restarts. Delete it and the engine appears as a new one. Never copy it to another machine: a studio binds the id to the first machine that used it and refuses the copy. |
| `engine.pid`, `engine-host.pid` | The running engine and supervisor. They let a new supervisor take over an engine left running, and stop a second supervisor from starting. |
| `.studio.log` | The log: the supervisor's lines and the engine's, each tagged and timestamped. It is emptied each time the command-line engine starts, and also echoed on the terminal. |
| `exts.json` | The plugin scan cache. |
| `paired-devices.json` | The phones and computers allowed to drive this engine over the local network. |
| `instruments/` | Downloaded sampled instruments. |
| `remote/<server>/` | Copies of a studio's project files, so a project plays from local disk. Undo audio kept here for a server is deleted a month after its last use. |

## Diagnostics

The supervisor has two extra modes. Neither starts the engine.

```sh
# Is this address a k7 studio that will accept the engine?
./k7-supervisor --probe app.k7.rocks
# → https://app.k7.rocks: an k7 registry

# Separate one file into stems on this machine, printing progress
./k7-supervisor --separate song.wav htdemucs.onnx out/ dml,cpu
```

The engine binary can list the audio interfaces it sees:

```sh
./k7-runtime --list-audio-devices
```

It prints a JSON list of devices with their names, backend (`type`), channel counts, and which one is current. Copy names from there into `audioPriority`.

## Running it as a service

The supervisor stays in the foreground and stops cleanly on SIGTERM. Run it under any service manager (systemd, launchd, a Windows service wrapper) with the working directory set to the unpacked folder and the command `k7-supervisor --config engine.json`. Its log is `.studio.log` in the state folder, and the service manager also gets every line on stderr.
