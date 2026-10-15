# Which files a document may make the engine open

A document names files by absolute path — a clip, a model, a record, a preset to load, a preset to
SAVE, the folder takes are recorded into — and whoever sends a document chooses those paths. Through
the tunnel that is a server; on the LAN, a paired device. So every path is held to a set of
**roots** where it arrives (`server/DocJson.cpp`, with `engine/PathRoots.cpp` as the test), and a
path outside them is dropped with a warning: the clip is silent, the module loads without its
preset, the project cannot record.

## The roots

| | roots |
|---|---|
| **write** — `presetSave`, `snapshot-plugin-base`'s `path`, `recordDir` | `<state>` (`$STUDIO_HOME`, else `~/.k7`), and every entry of `$STUDIO_ENGINE_ROOTS` |
| **read** — every other path a document names, `preview`'s `file`, `set-preset`'s `path` | the write roots, and the system's temp directory |

`<state>` covers what the engine is actually sent. A server-owned file is played from the
supervisor's copy under `<state>/remote/<server>/<root>` (`packages/engine-tunnel/docs/tunnel.md`) —
the account's workspace, the libraries, the models, the médiathèque — and an `@instruments/`
instrument resolves under `<state>/instruments`. A take and a saved preset land in that same copy,
which is what the tunnel uploads back.

`$STUDIO_ENGINE_ROOTS` is a path list (`;` on Windows, `:` elsewhere) for a machine whose documents
name local files elsewhere — a project driven straight from a checkout. It is read once, at start.

The temp directory is READ-only, and only because the harnesses in `scripts/` write their test
sources there and drive a running engine with them. Reading a file there plays it; it never writes
one.

`set-preset` may also load a `.vstpreset` that `list-presets` offered for that module — the
plugin's own `VST3 Presets` folders, which sit outside every root by design.

## What the test is

- **Symlinks resolved** (`weakly_canonical`) on the path and on the root, then compared component
  by component: `/root-other` is not under `/root`, and a link inside a root that points out of it
  counts as outside. A path that does not exist yet — a take, a preset about to be saved — is
  resolved as far as it exists.
- **A UNC path is refused everywhere** (`\\host\share`, `//host/share`, `\\?\…`): on Windows,
  opening one dials the network and hands the machine's credentials to the host it names.
- **A preset WRITE must end in `.vstpreset`**, any case: the engine deletes or overwrites that
  file on every autosave, so the extension is what keeps it from being any file under a root.
- **An `@instruments/` reference holds no `..`**, and a pattern lane's **sound name** is a single
  name (`safeSoundName`): both are joined under a folder, and `../` or an absolute name would
  leave it.

The CLI's one-shot modes (`--render`, `--decode`, …) set no roots: their document comes from whoever
runs the binary — a person, or the supervisor's render job on a document the tunnel already mapped.
Only a UNC path is refused there.

The supervisor holds its own jobs to the same copies, by its own test
(`engine/k7-supervisor/src/MachineJobs.cpp`): a job is answered by that process, not by this one.
