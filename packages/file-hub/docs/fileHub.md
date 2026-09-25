# The file hub — workspaces on the server

A workspace belongs to its account, not to whichever engine happens to be running. So the
server keeps it: `$STUDIO_FILES_ROOT/<account>/workspace/…`, served at `/api/files` by pl8, and
an engine only ever plays a **copy** it fetched through its tunnel
(`packages/engine-tunnel/docs/tunnel.md`). The server is the ONLY place a workspace lives: an
engine's machine is shared by whichever accounts play on it and holds none
(`packages/file-service/docs/owner.md`). So `$STUDIO_FILES_ROOT` is **required**: a pl8 without
it refuses to start, since the origin it would serve could open no project at all.

## One file-service process per account

The hub does not reimplement the file service: it runs `@studio/file-service` itself, in
**hosted** mode (`STUDIO_FILE_HOSTED=1`), one process per account with that account's folder as
its `$STUDIO_HOME`. A process and not one shared service, because the file service holds one
person's state in module globals — the owner, the pattern clock, the watchers, the document a
browser built — and a process boundary is the one isolation nobody can forget to thread through.
The price is a Node process per **active** account; an instance nobody called for 30 minutes is
stopped and starts again, in well under a second, on the next request.

An account's folder is `accountKey(email)`: the readable slug **and** a hash of the exact email,
since a slug alone folds `a.b@` and `a_b@` into one folder. The same key names its copy on an
engine's machine. Behind that, each hosted process records its one owner like any file service
(`packages/file-service/docs/owner.md`), so even a colliding key could not hand one account's
workspaces to another.

A hosted process listens on **loopback only** and its one gate is a secret the hub generated for
it. What only makes sense on an engine's machine is off: CORS (the hub answers the browser), the
machine's speakers (mpv), the médiathèque puller (the library is already on this disk) and the
dial to a local engine at boot.

## A ticket says who is calling

The browser's identity headers are **dropped**, not trusted: `x-studio-user` is set by the hub,
and the hub secret and engine token a client sends are removed. On an engine's machine the user
header is taken on faith behind the engine token; on a server shared by several accounts that
faith would let anyone open anyone's workspace.

Who it is comes from a **ticket**: `/api/files-hub`, behind the session guard, answers one — the
account's email and an expiry, signed with a key derived from the session secret, so a deploy does
not invalidate an open page. The browser sends it in the header the file service's gate already
reads, which spares every call a cookie across origins; `/api/files` itself has no session
guard, the ticket being its gate, with the session as a fallback for a same-origin caller.
Twelve hours, and the browser asks again after six.

## An engine is bound by a CLAIM

A request naming an engine (`x-studio-engine-id`) binds the account's file service to it only
when that account **holds a claim** on it in the registry. The registry lists every engine to
everyone, and a header is not permission; the claim is (`packages/engine-registry/docs/claim.md`).
A binding that fails leaves the files reachable and says why in the log.

A bound engine sees exactly two roots of the account: its `workspace/` folder, writable, so a take
comes back; and the médiathèque, read-only. **Never the rest of `$STUDIO_HOME`**, which holds the
account's SSH deploy key: an engine's machine may be a shared studio box, and the key is what
pushes to the account's repositories.

The engine's plugin list is fetched over the tunnel at binding time and written as
`<home>/exts.json`, the scan file's own shape, so everything that reads the engine's catalogue
works unchanged. A rescan on the engine's machine reaches the server at the next binding.

## An engine serves one account at a time

An engine is shared, never concurrently: the account holding its claim drives it. When the claim
moves on, the previous account's file service **lets go** of the engine at its next request, before
anything else, so a tab left open cannot push its project into an engine someone else is playing.
Each account's copy on the engine's machine stays in its own folder, `ws-<accountKey>`, and is
simply there again when that account comes back.

## What stays on the engine's machine

What drives or needs the machine's own hardware, for every account alike: its audio devices, its
plugins, its playlist sync targets (a USB stick is plugged into it), and playing a song on its
speakers. The engine machine's own file service still runs for those, with no workspace routes.
