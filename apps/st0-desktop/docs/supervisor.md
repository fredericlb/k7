# The supervisor runs in this process

`@studio/engine-host`'s `startSupervisor` is called here, in Electron's main process. It used to
be a child process — a vendored `node` running an esbuilt `engine-host.mjs`, driven over NDJSON
on stdio — and this page is what that change cost and bought.

## Why

Not performance: the supervisor's traffic is a snapshot when something changes and a command
when something is clicked, and no audio ever crossed that pipe.

It was **the process management** — a boundary whose whole job was babysitting, and which
generated its own failures. A spawned supervisor needs a program to find (three tiers, in a
particular order), a Job Object assignment, a relaunch backoff, a dev-reload exit code, an
NDJSON framing whose invariant was *"one stray line on stdout corrupts everything"*, and a
pidfile lock to stop a second one existing. Each of those is a thing that can be wrong on its
own, and several of them were: a stale `engine-host.pid` whose pid Windows had recycled would
refuse every new supervisor **forever**, and the only symptom was an app that ran and did
nothing.

Embedding deletes the tiers, the backoff, the framing and the reload code. It does not delete
the lock — `studio-engine` can still be running — and it does not delete the Job Object, which
matters more now, not less.

## What it does NOT change

The engine and the file service are still separate processes, and the boundary that matters is
still there. A VST3 that crashes takes the engine down and not the window; `--render` is still
offline and elsewhere. The argument for keeping THAT boundary is in the root `AGENTS.md` and
`engine/moteur/docs/multiEdit.md`; nothing here touches it.

`cli.ts` is still an equal front end. `HostTransport` is still the only way frames move, even
though both ends now share an address space — reach past it and `studio-engine` quietly becomes
the lesser implementation, which is the thing one-supervisor-two-front-ends exists to prevent.

## The three things a vendored node gave for free

**1. The certificate store.** A registry is routinely fronted by a local proxy with a private
CA that lives in the OS store and nowhere else. Node's `fetch` does not read that store, so the
heartbeat handshake fails *silently* and the engine never appears in that UI's picker — no
error, no log line, just an absence. `--use-system-ca` was the answer for a child of a Node we
ship; here the answer is better: `net.fetch` goes through Chromium, which reads the store
natively. `setRegistryFetch` is the seam, and its default stays node's for the CLI.

**2. Where the bundle is.** `bundle.ts` derived its resource directory from
`process.execPath` — which, for a supervisor that WAS the vendored node, pointed straight at
the staged flat directory. In here `process.execPath` is Electron, whose exe has no `node`
beside it, so `vendoredNode()` would return null and every caller would read that as *"this is
a dev run"* — the file service would never be spawned in a packaged app. `setBundleRoot` is
told `process.resourcesPath` instead of guessing. `stage.mjs`'s flat layout is still
load-bearing, for that reason rather than the old one.

**3. Membership in the Job Object.** `assign()` was called on the supervisor child, and
everything it spawned inherited. There is no such child now, so **this process** joins the job
(`job.assignSelf()`), and the engine and file service inherit from us. Miss it and a
force-killed app orphans both, on their ports, with nothing to say why.

## Teardown

`shutdown()` in the supervisor used to end with `process.exit(0)`, which is right when it owns
the process and fatal when it does not — it would cut `before-quit` short, leaving the window,
the local server and the dev pidfile behind. `SupervisorOptions.exit` is what a host passes to
say *"tell me instead"*, and passing it also takes the `SIGINT`/`SIGTERM`/`SIGHUP` handlers
away, since two teardowns racing is how a quit half-runs.

`docs/lifetime.md` has the order the app tears down in, which is unchanged apart from there
being one fewer process in it.
