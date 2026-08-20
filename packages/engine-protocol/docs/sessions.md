# Sessions — which project on the engine a client is driving

One engine process hosts several projects at once (measured — see
`engine/moteur/docs/multiEdit.md`). A **session** is the name of one of them. The wire rule
lives in `engine/moteur/docs/protocol.md`; this page is about the client side: who picks the
name, and the two ways it goes wrong.

## Why there is a name at all

Before sessions, the engine held one project. Everything that reached it applied to that
one, so:

- opening a module in the médiathèque's builder replaced the song open in st0;
- an m9 deck loading a track did the same;
- and the state frames were global, so st0' transport light lit up when a deck played.

Nothing arbitrated. The last `project` message won, in silence — nothing failed, nothing
was logged, the song simply stopped being loaded.

## Who passes what

Both clients — `@studio/engine-browser`'s `EngineClient` and `@studio/engine-client`'s
`EngineControl` — take the session in their constructor and stamp it on **every** outgoing
message, at the single `send()` both funnel through. That is the point: a verb added later
is addressed by construction, and there is no per-call site to forget.

The granularity is one session per **service and per person** — `sessionFor("st0",
email)` → `st0:fred_parapluie_org`. The service half is what stopped st0, the
médiathèque and m9 from overwriting each other. The person half became necessary the
moment an engine could be **chosen per account**: two people can now pick the same machine,
and on a bare `st0` they would drive one project between them — the same collision, moved
up a level.

One session per person, not per workspace. A person drives one project at a time, and
splitting per workspace would leave a stopped project loaded in the engine forever.

`sessionFor` takes the raw email and slugs it itself. Each caller slugging first would be
two chances to slug differently, which is exactly the failure the next section is about.

## Two ways it goes wrong

**Both halves of an app must spell it the same.** st0 has two: the file service compiles
the song and sends it (`packages/file-service/src/engineLink.ts`), the browser drives its
transport (`apps/st0/frontend/src/hooks/useEngineLink.ts`). Give them different ids and
nothing errors — the song plays in one session while the frontend steers an empty other,
which reads as "the engine ignores Play".

They reach the same string by different routes: the browser slugs the logged-in email, the
file service reads the owner slug out of `~/.studio/root/<slug>/<workspace>`. Those *are* the
same slug, and `packages/file-service/src/engineLink.test.ts` is the one test that says so.
It is the only thing in the repo that would catch them drifting.

**Filtering incoming frames is on disagreement, not absence.** `forSession()` lets a frame
with no `session` field through. The binary audio frames need no filter at all — the engine
already routes those per socket.

The 20 Hz `state` frame is now routed per socket *as well as* stamped: the engine remembers which
project each connection named in its first real message and sends each frame only to those. That
is an optimisation, not a second filter, and `forSession` still runs on the result. Read the two
in that order — the engine addresses with what a socket has said so far, the client decides with
what the frame says. Relaxing the client because the engine got tidier would make a socket that
has not spoken yet read someone else's meters.

That rule is safe because of something outside this package, and it is worth being exact about
it. The unstamped replies are a **closed set**, not a tendency: `ENGINE_GLOBAL_REPLIES` in
`sessions.ts` names all five, `PER_SESSION_REPLIES` names the rest, and `sessions.test.ts` pins
both. Everything in the second list is stamped by the engine, so against a current engine the
only frames that arrive unstamped are genuinely the machine's. Against an engine *older* than
sessions nothing is stamped, and that is the case pass-on-absence exists for — requiring the
field would make a new client silently deaf rather than merely unsorted.

So the correctness of one line here lives in `engine/moteur/server/main.cpp`, in its choice
between the `broadcast` and `broadcastTo` verbs. It was not always true: for a while only
`state` and `session-dropped` were stamped, and an pl8 module audition made st0 flash `busy`
and receive `applied`/`flushed`/`recorded` for a project it did not own.

A capability handshake was considered instead and rejected: it would only help if the engine
*forgot* to stamp something, and would then make the client deaf on that frame rather than
merely unsorted — strictly worse, and equally silent.

`DEFAULT_SESSION` is `""`, and the engine reads a missing field as exactly that. So a
client that has never heard of sessions and one passing the default are the same client,
byte for byte. Do not give the default a name: every such client would move to a different
project on the same engine, in silence.

**A session is created by driving it, and asking about one never creates it.** That is the
engine's rule rather than this package's, but it is what makes the supervisor's polling safe —
it holds a `DEFAULT_SESSION` client and would otherwise have conjured `""` on every tick. See
`engine/moteur/docs/sessions.md`, which also covers when an empty session is reaped.
