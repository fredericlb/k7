# The engine wire's version

`ENGINE_PROTOCOL` (`version.ts`) is one integer for the whole engine wire: the frames a browser and
the relay exchange with the engine, the tunnel's frames, and what the supervisor's heartbeat
carries. It is stated three times — in `whoami` by the engine, in the heartbeat and in the tunnel's
`x-studio-engine-protocol` upgrade header by the supervisor — and written three times, here and in
the two `WireVersion.h` (`engine/k7-runtime/server`, `engine/k7-supervisor/src`), which
`version.test.ts` keeps equal.

## What bumps it

A change that an engine machine on the previous version would MISREAD: a frame whose meaning
changed, a field renamed or dropped, a reply a server now waits for. Adding a field a reader may
ignore, or a frame type an older reader will drop, does not bump it. An older tunnel peer drops a
frame type it does not know and says so once per type in its log, so an additive change shows up
rather than vanishing.

## The server serves a minimum, and says so

`MIN_ENGINE_PROTOCOL` is the oldest version a server still serves. The hub refuses a tunnel below it
with `426 Upgrade Required` and a body naming both versions, logged once per engine; the registry
lists every engine's version with `outdated: true` below the minimum, and the engine picker shows
"update k7 on this machine" on that row and does not let it be picked. A version above the
server's own is served: the server is deployed first, so an engine ahead of it is a test machine.

Raise the minimum only when the server drops what the older version needs, and in the same commit
as that drop.

## Absent means 1

Nothing stated a version before version 1, and no installed base predates it: a `whoami`, a
heartbeat or an upgrade without the field speaks 1. That keeps every engine in the field serveable
on the day the field appears, and makes the first bump the first refusal.

## The build stamp beside it

Each binary also states `build`, from `$STUDIO_RELEASE_STAMP` when CMake configured it: the release
tag itself (`v0.1.0`), the version a snapshot was cut from with its stamp (`0.1.0-snapshot-9f2c1ab`),
and `<version>-dev` for a local build. The version is the repository's one (`docs/versioning.md` at
the root), read from `engine/k7-runtime/package.json`, which copies it and is the one package.json the
engine's Docker build context holds. It is information, not a gate, with one use: a supervisor that
ADOPTS a running engine compares the engine's protocol and build with its own and replaces an engine
of another one (`engine/k7-supervisor/docs/crashLoop.md` covers the other reason it replaces one).
Two local builds of one version read the same, so a developer's rebuilt supervisor does not kill the
engine it finds.
