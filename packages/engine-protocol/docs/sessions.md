# Sessions — which project on the engine a client is driving

One engine process hosts several projects at once (`engine/k7-runtime/docs/multiEdit.md`). A
**session** is the name of one of them. The wire rule lives in
`engine/k7-runtime/docs/protocol.md`; this page is about the client side: who picks the name, and
the two ways it goes wrong.

## Why there is a name at all

Without a name the engine holds one project, and everything that reaches it applies to that
one:

- opening a module in the médiathèque's builder replaces the song open in k7;
- a deck loading a track does the same;
- and the state frames are global, so k7's transport light lights up when a deck plays.

Nothing arbitrates. The last `project` message wins, in silence — nothing fails, nothing is
logged, the song simply stops being loaded.

## Who passes what

Both clients — `@studio/engine-browser`'s `EngineClient` and `@studio/engine-client`'s
`EngineControl` — take the session in their constructor and stamp it on **every** outgoing
message, at the single `send()` both funnel through. That is the point: a verb added later
is addressed by construction, and there is no per-call site to forget.

The granularity is one session per **service and per person** — `sessionFor("k7",
email)` → `k7:fred_parapluie_org`. The service half is what keeps k7 and the médiathèque
from overwriting each other. The person half is what an engine **chosen per account** needs:
two people can pick the same machine, and on a bare `k7` they would drive one project between
them — the same collision, moved up a level.

One session per person, not per workspace. A person drives one project at a time, and
splitting per workspace would leave a stopped project loaded in the engine forever.

**The bench is the exception, and a service of its own** — `SESSIONS.bench`, `banc:<person>`. It
is the one project a person opens BESIDE the song rather than instead of it: a rig to hear a chain
through, which the rehearsal recorder records while the song stays loaded
(`packages/ui-rehearsal/docs/chainSource.md`). It is also
thrown away on every open, so the "stopped project loaded forever" above costs one small rig at
most. The browser names it from the `@banc` address, the file service from the `Banc` workspace
(`apps/k7/frontend/src/engineSession.ts`, `sessionOf`), and a test on each side pins both to this
constant.

`sessionFor` takes the raw email and slugs it itself. Each caller slugging first would be
two chances to slug differently, which is exactly the failure the next section is about.

## Two ways it goes wrong

**Both halves of an app must spell it the same.** k7 has two: the file service compiles
the song and sends it (`packages/file-service/src/engineLink.ts`), the browser drives its
transport (`apps/k7/frontend/src/hooks/useEngineLink.ts`). Give them different ids and
nothing errors — the song plays in one session while the frontend steers an empty other,
which reads as "the engine ignores Play".

They reach the same string by different routes: the browser slugs the logged-in email, and the
file service is TOLD the email — `noteOwner`, from the header every request carries — rather than
reading it out of a path: no level of the workspace path names a person
(`packages/engine-client/docs/paths.md`), since one machine holds one person's workspaces. `packages/file-service/src/engineLink.test.ts` is the one test that says
the two halves still agree.
It is the only thing in the repo that would catch them drifting.

**Filtering incoming frames is on disagreement, not absence.** `forSession()` lets a frame
with no `session` field through. The binary audio frames need no filter at all — the engine
already routes those per socket.

The 20 Hz `state` frame is routed per socket *as well as* stamped: the engine remembers which
project each connection named in its first real message and sends each frame only to those. That
is an optimisation, not a second filter, and `forSession` still runs on the result. Read the two
in that order — the engine addresses with what a socket has said so far, the client decides with
what the frame says. Relaxing the client because the engine got tidier would make a socket that
has not spoken yet read someone else's meters.

That rule is safe because of something outside this package, and it is worth being exact about
it. The unstamped replies are a **closed set**, not a tendency: `ENGINE_GLOBAL_REPLIES` in
`sessions.ts` names them all — the machine's, a plugin type's, and pairing's, which are about a
device — `PER_SESSION_REPLIES` names the rest, and `sessions.test.ts` pins both, down to reading
the engine's own handlers: every `broadcast`, `broadcastLocal` or `sendTo` there must name a reply
of the first list, every `broadcastTo` one of the second. Everything in the second list is stamped by the engine, so against a current engine the
only frames that arrive unstamped are genuinely the machine's. Against an engine *older* than
sessions nothing is stamped, and that is the case pass-on-absence exists for — requiring the
field would make a new client silently deaf rather than merely unsorted.

So the correctness of one line here lives in the engine's message handlers, `engine/k7-runtime/server/Serve*.cpp`, in their choice
between the `broadcast` and `broadcastTo` verbs. Stamp one reply too few and a media-library module
audition makes k7 flash `busy` and receive `applied`/`flushed`/`recorded` for a project it
does not own.

A capability handshake is the wrong answer to that: it would only help if the engine *forgot*
to stamp something, and would then make the client deaf on that frame rather than merely
unsorted — strictly worse, and equally silent.

`DEFAULT_SESSION` is `""`, and the engine reads a missing field as exactly that. So a
client that has never heard of sessions and one passing the default are the same client,
byte for byte. Do not give the default a name: every such client would move to a different
project on the same engine, in silence.

## Putting one down: `flush` versus `dropSession`

`flush` empties a session — plugins, edit and diff baseline — and leaves the session itself
behind, so the next document is built from scratch rather than diffed against the old one.
`dropSession` **removes** it: its edit, its plugins, its meters and its broadcast tap.

The difference matters because the key space is (service × person), so an engine on a shared
machine accumulates one entry per person who has ever pointed at it and frees them only when the
process dies. A surface that is done with a project should say so.

**A session is created by driving it, and asking about one never creates it.** That is the
engine's rule rather than this package's, but it is what makes the supervisor's polling safe —
it holds a `DEFAULT_SESSION` client and would otherwise have conjured `""` on every tick. See
`engine/k7-runtime/docs/sessions.md`, which also covers when an empty session is reaped.
