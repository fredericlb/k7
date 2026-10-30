# The share player — a visitor's session on the server's engine

`src/media/shares/player.ts`. A share is played live (`shares.md`): each visitor of a link gets a
session of their own on the server's engine (`docs/server-engine.md`), opened by this backend.

## One session per visitor

Two people on one link hear their own transport and their own mute and solo. A session per SHARE
would be a listening party where one visitor's pause is everyone's, and a link is sent to people who
do not know each other. The engine holds up to 64 sessions, shared with every account playing on it,
so the player caps what it takes: 8 visitors at once across every share and 2 from one address
(`PlayerDeps`). The address is the one the edge appended to `X-Forwarded-For`, read as `req.ip`
reads it under `trust proxy` 1 (`visitorAddress`): behind Traefik the socket's own address is the
proxy's, which would make every visitor one address. Past the cap, the socket is refused with a sentence. A visit holds its session for 3
hours at most, so a forgotten tab does not keep a slot.

The session is `share:<random>`, never anything a visitor chose. It is dropped (`drop-session`) when
the visitor's socket closes, which also frees its slot against the 64.

A visitor on a weak link, or one gone without a FIN, must not hold a slot nor grow the backend at
the broadcast's bitrate. What the engine sends a visitor goes through `sendBounded`
(`packages/engine-tunnel/docs/backpressure.md`): past 8 MiB unsent the audio and `state` frames are
dropped, past 64 MiB the visit ends with 1013. The socket is pinged every 30 s and terminated after
one unanswered ping (`packages/engine-tunnel/docs/upgrade.md`), which ends the visit. The socket is
accepted with an error listener first, since a refused visitor still reads frames until its close
completes, and a malformed one would otherwise end the process.

## The visitor never touches the engine's socket

The engine refuses nothing on a socket it trusts, and a tunnel channel arrives as a trusted
loopback peer: whoever holds one can load any document, reach any file the roots share, drop other
people's sessions and read the engine's token. So a visitor gets **no** relay ticket. The backend
opens the channel itself, and the visitor's socket reaches it only through `allowed`:

| from the visitor | reaches the engine as |
|---|---|
| `transport` play / stop / toggle / rewind / panic, `seek` to a position ≥ 0, `loop` | the same, stamped with the visitor's session |
| `track-mix` (ids, mute, solo) | `tracks`: the WHOLE track from the visitor's own copy of the document, since `tracks` replaces by id |
| anything else | nothing |

The other direction is filtered too. Only `state`, `busy` and `applied` reach the page, stripped of
their session; an engine `error` or warning can quote a path on this server. The audio broadcast
is forwarded as is: it is per socket, so it is this session's alone.

The page is told `audioToBrowser` at once. The broadcast is the only way to hear the server's engine,
and the shell's own `playEngineOutput` then plays it with no code of the share's.

## What the channel shares

Three read-only roots: the share's own folder, the libraries, and the media library. The document is
read from `engine-doc.json`, and every `k7-share:` path in it becomes the share's folder here. The
tunnel brings each file down before the frame naming it reaches the engine, so the first play of a
share waits for its files, and a later visit finds them already on the machine.

## Whether a share can be made at all

`check()` is the same question the author's file service asks before it starts
(`GET /api/shares/player`): a server with no render key has no engine of its own, and one whose
engine is not connected cannot play now. Both refuse the share outright, rather than handing out a
link that answers nothing.
