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
(`packages/file-hub/docs/fileHub.md`). A token is a signed `{jti, sub, iat, exp}` that is valid only while
its id is listed in the library's token store, so one can be revoked alone ([../sessions.md](../sessions.md)); the
two handed over in code are ephemeral, held in this process's memory only.

The secret is `API_TOKEN_SECRET`, or `SESSION_SECRET` with `:pl8` appended when that is unset
(`mount.ts`). Changing it revokes every token at once.

`POST /api/token` mints one, `GET /api/token` lists the owner's and `DELETE /api/token/:id` revokes one;
all are **session only**, deliberately: a token must not be able to mint another. `GET /api/token/pair` hands one to a native app on its loopback port, and
`isLoopbackReturn` is that route's whole security. Two routes refuse the bearer for reasons of their
own — the hunt, which spends an account's reputation ([hunt.md](hunt.md)), and the settings, which
hold the slskd key and have no headless caller ([settings.md](settings.md)).

## The order of the mounts is the guard

The player router is mounted on `/api` behind `bearerOrSession`, and k7's preferences on `/api`
behind `requireAuth`: each guards every `/api` route mounted AFTER it. So `mountMedia` runs before
the preferences, and the public share router is mounted above everything else in it — a route
mounted in the wrong place becomes unreachable rather than public, which is the right direction for
that mistake to fail ([shares.md](shares.md)).

## Taking something out is an admin's

The library is ONE folder that every account of the origin reads and files into, so a removal is
never only the remover's: an artist folder deleted by one account is every account's songs gone,
and there is no trash to bring them back from. So everything that takes bytes out of it or
reshapes it answers 403 unless the caller is an admin (`AUTH_ADMIN_GROUPS`, `../../src/media/admin.ts`):

| route | why it is gated |
|---|---|
| `DELETE /folder` | a subtree — and a song is a folder, so removing ONE song is a subtree too |
| `DELETE /file`, `DELETE /variant` | one file, and nothing on disk says which account filed it, so there is no owner to let through |
| `POST /move` of a folder, or onto a file that exists | a folder move empties every path under it; a move onto a file replaces it |

Adding stays open to every account — an upload, a hunt's find, a new folder, a recording, a file
renamed to a free name — since none of those can take anything away from anybody else. Ownership
would be the narrower rule for a single file, and it is not available: `source:` in `song.yaml`
names the tool that filed a song (`packages/mediatek/docs/songs.md`), not the account.

A bearer token is no admin: it carries no groups, and none of its callers removes anything.

The tray's backend and the phone's are the exception. Their backend runs with `STUDIO_LOCAL_USER=1`, answers
loopback only, and holds that machine's own library, so whoever reaches it may manage it — and the
local user is never an admin ([../standalone.md](../standalone.md)).

`GET /api/mediatek` answers `manage` with the same decision, and the médiathèque hides the
removals, the folder renames and the folder drags when it is false
(`packages/ui-library/docs/library.md`). The rule is `../../src/media/libraryGate.ts`.
