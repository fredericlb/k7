# Sessions — which project on the engine a client is driving

One engine process hosts several projects at once (measured — see
`apps/moteur/docs/multiEdit.md`). A **session** is the name of one of them. The wire rule
lives in `apps/moteur/docs/protocol.md`; this page is about the client side: who picks the
name, and the two ways it goes wrong.

## Why there is a name at all

Before sessions, the engine held one project. Everything that reached it applied to that
one, so:

- opening a module in the médiathèque's builder replaced the song open in pistes;
- an m9 deck loading a track did the same;
- and the state frames were global, so pistes' transport light lit up when a deck played.

Nothing arbitrated. The last `project` message won, in silence — nothing failed, nothing
was logged, the song simply stopped being loaded.

## Who passes what

Both clients — `@studio/engine-browser`'s `EngineClient` and `@studio/engine-client`'s
`EngineControl` — take the session in their constructor and stamp it on **every** outgoing
message, at the single `send()` both funnel through. That is the point: a verb added later
is addressed by construction, and there is no per-call site to forget.

The granularity is one session per **service and per person** — `sessionFor("pistes",
email)` → `pistes:fred_parapluie_org`. The service half is what stopped pistes, the
médiathèque and m9 from overwriting each other. The person half became necessary the
moment an engine could be **chosen per account**: two people can now pick the same machine,
and on a bare `pistes` they would drive one project between them — the same collision, moved
up a level.

One session per person, not per workspace. A person drives one project at a time, and
splitting per workspace would leave a stopped project loaded in the engine forever.

`sessionFor` takes the raw email and slugs it itself. Each caller slugging first would be
two chances to slug differently, which is exactly the failure the next section is about.

## Two ways it goes wrong

**Both halves of an app must spell it the same.** pistes has two: the file service compiles
the song and sends it (`packages/file-service/src/engineLink.ts`), the browser drives its
transport (`apps/pistes/frontend/src/hooks/useEngineLink.ts`). Give them different ids and
nothing errors — the song plays in one session while the frontend steers an empty other,
which reads as "the engine ignores Play".

They reach the same string by different routes: the browser slugs the logged-in email, the
file service reads the owner slug out of `~/.studio/root/<slug>/<workspace>`. Those *are* the
same slug, and `packages/file-service/src/engineLink.test.ts` is the one test that says so.
It is the only thing in the repo that would catch them drifting.

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
