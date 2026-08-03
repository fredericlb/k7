# Sessions — which project on the engine a client is driving

One engine process hosts several projects at once (measured — see
`apps/moteur/docs/multiEdit.md`). A **session** is the name of one of them. The wire rule
lives in `apps/moteur/docs/protocol.md`; this page is about the client side: who picks the
name, and the two ways it goes wrong.

## Why there is a name at all

Before sessions, the engine held one project. Everything that reached it applied to that
one, so:

- opening a module in the médiathèque's builder replaced the song open in lanes;
- a platines deck loading a track did the same;
- and the state frames were global, so lanes' transport light lit up when a deck played.

Nothing arbitrated. The last `project` message won, in silence — nothing failed, nothing
was logged, the song simply stopped being loaded.

## Who passes what

Both clients — `@studio/engine-browser`'s `EngineClient` and `@studio/engine-client`'s
`EngineControl` — take the session in their constructor and stamp it on **every** outgoing
message, at the single `send()` both funnel through. That is the point: a verb added later
is addressed by construction, and there is no per-call site to forget.

Today the granularity is one session per **service** (`SESSIONS` in `sessions.ts`). That is
what ends the collision above. It is not the end state: two users on two workspaces still
share `lanes`, and per-user ids are their own step.

## Two ways it goes wrong

**Both halves of an app must spell it the same.** lanes has two: the file service compiles
the song and sends it (`packages/file-service/src/engineLink.ts`), the browser drives its
transport (`apps/lanes/frontend/src/hooks/useEngineLink.ts`). Give them different ids and
nothing errors — the song plays in one session while the frontend steers an empty other,
which reads as "the engine ignores Play".

**Filtering incoming frames is on disagreement, not absence.** `forSession()` lets a frame
with no `session` field through. Most replies are engine-global (the device list, the
installed-plugin catalogue), and an engine older than sessions stamps nothing at all;
requiring the field would make a new client silently deaf against an old engine rather
than merely unsorted. The binary audio frames need no filter — the engine already routes
those per socket.

`DEFAULT_SESSION` is `""`, and the engine reads a missing field as exactly that. So a
client that has never heard of sessions and one passing the default are the same client,
byte for byte. Do not give the default a name: every such client would move to a different
project on the same engine, in silence.
