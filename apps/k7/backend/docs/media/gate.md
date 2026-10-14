# Who may reach the library

## The pages: the account, and nothing else

k7 stacks `AuthGate → EngineGate → ProjectGate` in front of a project. The library's pages, under
`/media`, need the first and none of the others:

- **Auth**, because every route but the public share is behind a session or a bearer.
- **No engine gate.** The catalogue is served by this backend, over its own volume; nothing about
  browsing it depends on a machine that makes sound. Playing a song on an engine picks one where it
  is asked for, in the playback picker (`packages/ui-library/docs/playbackTarget.md`).
- **No workspace and no project.** The library belongs to the account, not to a repository, and a
  project is opened elsewhere (`packages/project-shell/docs/launch.md`).

The session is this backend's own: it runs the origin's OIDC flow and mints `studio.sid`
(`apps/k7/AGENTS.md`), so the library verifies the same cookie the editor does, in the same
process, with nothing to agree on.

## The bearer token, beside the session

`bearerOrSession` guards the library, the shares, the stems and the host's player, because their
other callers have **no cookie jar**: the rehearsal server filing a take — mounted in this process,
yet calling the library over loopback with a `service:k7` token minted here — and each account's
file service,
which this process starts and hands a token so it can reach the médiathèque over loopback
(`packages/file-hub/docs/fileHub.md`). A token is a signed `{sub, iat}` with no server-side storage,
and rotating the secret revokes every one at once.

The secret is `API_TOKEN_SECRET`, or `SESSION_SECRET` with `:pl8` appended when that is unset
(`mount.ts`). The suffix is the library's name and is part of every token already issued — machine
caches and the tokens the file services and the rehearsal server hold — so changing it is a revocation of all of them, not a rename.

`POST /api/token` mints one and is **session only**, deliberately: a token must not be able to mint
another. `GET /api/token/pair` hands one to a desktop app on its loopback port, and
`isLoopbackReturn` is that route's whole security. Two routes refuse the bearer for reasons of their
own — the hunt, which spends an account's reputation ([hunt.md](hunt.md)), and the settings, which
hold the slskd key and have no headless caller ([settings.md](settings.md)).

## The order of the mounts is the guard

The player router is mounted on `/api` behind `bearerOrSession`, and k7's preferences on `/api`
behind `requireAuth`: each guards every `/api` route mounted AFTER it. So `mountMedia` runs before
the preferences, and the public share router is mounted above everything else in it — a route
mounted in the wrong place becomes unreachable rather than public, which is the right direction for
that mistake to fail ([shares.md](shares.md)).
