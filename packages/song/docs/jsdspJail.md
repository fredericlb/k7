# The jsdsp jail

A `jsdsp.ts` is code an account wrote, and compiling a project RUNS it (`graphModel.md`, "`jsdsp` and
Faust"). On the server, that compile happens in the account's file service. Every account's file
service runs as the same OS user, and its parent holds the origin's secrets. Run unconfined, a module
could read `SESSION_SECRET` or another account's workspace, so the whole origin would trust its least
careful author. The feature is kept and confined instead: `src/compile/jsDspJail.ts` and the program
it sends, `src/compile/jsDspChild.ts`.

## The choices

| choice | why |
|---|---|
| esbuild transpiles the source in the PARENT, as a transform and never a bundle | the child then needs no TypeScript loader, so it needs no file at all. A bundle would resolve the module's imports with the file service's rights and inline another account's file |
| the child reads its program, `@studio/dsp` and the module from stdin, as `data:` URLs | under `--permission` with no `--allow-fs-read`, a file of our own would be one more path to allow |
| `--permission` with nothing granted | no file read or write, no child process, no worker, no addon, no inspector. It is the gate the rest leans on |
| a resolve hook refuses every import but the two `data:` URLs, and `@studio/dsp` maps to its own | node 24's permission model has no network gate, so `node:net` and `node:http` are closed by refusing the import, along with every other builtin |
| `fetch`, `WebSocket`, `EventSource` and `process`'s escape hatches are deleted before the module loads | these reach a builtin or the network without an import |
| an empty environment | nothing a module could print back. Only `SystemRoot` on Windows is set, which the binary needs to start (and `ELECTRON_RUN_AS_NODE` when the parent is Electron's node). On Windows libuv adds the variables it holds a process needs (`PATH`, `TEMP`, `USERNAME`, `USERPROFILE`…) to every child it spawns, and no option of node's turns that off: there the module sees those, which name the user and their folders and nothing secret |
| `--disallow-code-generation-from-strings`, a 256 MB heap, 30 s and `SIGKILL`, 1 MB of output | a module may fail or loop, but it cannot make the compile hang or swallow the box |
| a module with no default export prints `{}` | its node keeps its place in the chain, with no parameters, instead of disappearing |
| the module may not import at run time | a song folder has no `node_modules`, and the builder already arrives as an argument. `import type` is erased and is all a module needs |

## A separate OS user, where there is one

Node documents its permission model as a seat belt and not a sandbox against malicious code. A
second wall has to hold if it gives way, and that wall is the OS: the child runs as a user that
owns nothing.

- **The k7 image** has a `dsp` user (uid 10001) and `/usr/local/libexec/dsp-exec`
  (`apps/k7/docker/dsp-exec.c`). This setuid-root helper can be executed by group `node` only. It
  drops to `dsp`, clears the environment and execs node, and it can only LOWER privilege, to one
  uid compiled into it. `STUDIO_DSP_EXEC` names it, and the file hub passes that variable on. The
  volumes are mode 700 and owned by `node`, and the container's start re-applies that mode to a
  volume created before it, so `dsp` can read no workspace. `/proc/<pid>/environ` of a `node`
  process is closed to `dsp` as well.
- The backend stays `node`. A setuid helper is chosen over the alternatives because each of them
  hands out more:
  - giving `node` `CAP_SETUID` would give the jailed child that capability too, since it is the
    same binary;
  - starting as root and dropping later keeps a root process alive;
  - a pre-forked privileged daemon is more code holding the same privilege.
- **A process running as root** drops the child to `STUDIO_DSP_UID`/`STUDIO_DSP_GID`, or to
  `nobody` (65534) when neither is set. It never runs a module as root.
- **The tray and the phone** have one user, and it is the author's own, so they skip this
  layer. The environment, the permission model and the hook still apply.

## What stays open

- The network under the tray and on the phone, if a module finds a way past the hook. In the image,
  `dsp` has the same network as `node`.
- CPU for 30 seconds per compile. The result is cached in `jsdsp.json`, so steady state runs nothing.
- The tray and the phone apps have no esbuild beside their bundle, so it runs no jsdsp at all and
  plays the committed `jsdsp.json`.
