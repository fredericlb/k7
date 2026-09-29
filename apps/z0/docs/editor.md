# editor — the editor that opens a project

Edits a **`.z0` folder** in a workspace ([projects.md](projects.md)). z0's only editor; it
answers at `/z0/editor`, on port 3006. The **YAML** button shows the file as it will be written,
because the format is young and looking at what is really on disk is worth having.

## It never talks to z0's backend

The five other z0 SPAs talk to the game's backend — guests with no account on `bt_session` —
and take their account login at the root of the origin ([auth.md](auth.md)). This one takes
everything from elsewhere:

| what it needs | where it comes from |
|---|---|
| who you are | `/auth/*` at the root of the origin — st0 |
| which machines exist, and which is yours | `/api/engines*` — pl8's registry |
| the project's files | the account's file service, behind pl8's file hub |

None of those three questions has an answer on z0's side: the game's backend does not know the
account's workspaces, has no engine registry — it has one, named by the environment for an
offline render — and knows nothing of a working copy. Answering them there would mean a second
registry and a second login for one account.

The game keeps its guest door. A player does not sign in here; the blind-test's author opens
their workspace, on the same account as st0 and the media library.

## The three gates are `@studio/project-shell`'s, not rewritten

Login, then the machine, then the project — `POST /open` on the `.z0` folder the address names
([launch.md](../../../packages/project-shell/docs/launch.md)). A second way of answering which
addresses open what would open a project in one editor and refuse it in the other, which is what
the shared package exists to prevent.

## The address carries one segment more than st0's

`priv.st0.app/z0/editor/@local/<workspace>/<session.z0>`, per `PROJECT_MOUNTS`: st0 **is** its
service, whereas z0 is six SPAs behind a prefix and one of them opens a project. The router's
`basename` is that whole address, so nothing in the app can rewrite the project away.

Two tables in `@studio/web-protocol` carry the rest: `PROJECT_SUFFIXES` declares `.z0` a project
suffix, so pl8 lists those folders and the file service agrees to open one; `SERVICE_PATHS`
declares where `z0` answers, which is a different question from which cookie it carries.

## To check in a browser

The suites here mount nothing.

- open a `.z0` session from st0's home page → the address is `/z0/editor/<repo>/<session.z0>`
  and stops moving; reload → the same session;
- a repository this machine has never seen → git's progress bar, then the file list; again → no
  clone;
- rename the `.z0` folder on the machine and reload → "this session is not in the repository",
  not the CORS screen.

## Known dead code

`backend/src/editor/` (with `editor.test.ts`) mounts Grist routes no client calls. To delete
once nothing is found to touch them. `backend/src/grist/` stays — it loads the game's rounds.
