# Where the hosted médiathèque is, seen from the engine's machine

Two values — `MEDIATEK_URL` and `MEDIATEK_TOKEN` — that everything talking to pl8 from this
service depends on: the cache sync (`mediatekPull.ts`), the `/mediatek/*` routes, and the
**SSH key** `sshKeys.ts` fetches in order to clone a repository.

## What supplies them, and what does not

The supervisor passes them in the environment when **it** is the one starting this service
(`packages/engine-host/src/fileServiceProcess.ts`). That is the case under the desktop app.

In a checkout it never is. The dev session starts this service as its own Tilt resource
(`scripts/tilt-tasks.mjs`: a package joins the session by having a `dev` script), so by the time
the supervisor arrives the port already answers — `ensure()` classes the service "foreign" and
has no environment to hand it. Neither value arrives.

The symptom is not "the sync is idle" but, on opening a project:

```
no SSH key on this machine and no hosted library configured (MEDIATEK_URL) to ask for one
```

Hence the fallback, onto the same files the supervisor itself reads.

## The URL: pl8's file, by name

`<state>/web-endpoints/pl8.json`, and not the origin of whichever registry answers first.
Hosted, every service shares one origin at a fixed path, so the two would agree. In a checkout
they do not: each backend announces **its own** loopback port, so "the origin of any registry"
lands on st0's 8789 as often as on pl8's 8795 — and the médiathèque's routes are not there.

That is the same address `packages/git-repos/docs/keys.md` gives for dev
(`http://localhost:8795`), obtained by reading it rather than writing it down twice.

## The token: the supervisor's settings

`<state>/engine-host.json`, key `mediatekToken` — where `npm run tokens` writes it and where the
supervisor reads it before passing it on. Reading it directly only removes an absent middleman.

## And the token's subject

Knowing where to ask does not yet say **for whom**. The token a machine holds is a service's
(`sub: "service:st0"`), which has no key of its own, while the key is filed under the person's
OIDC subject. So `sshKeys.ts` names the user in the request — the email, the only spelling this
service knows — and pl8 bridges to the subject. That is an identity decision with a price:
`apps/pl8/docs/sshKeyForService.md`.

## Sharing goes through the same pair

`Workspace.shareLink` renders the snapshot and posts it to pl8 with this same bearer — not k7's
`.settings.json` pair. Sharing needs no new plumbing: this service already talks to pl8 with
this token. And for the reason above, the user is named on every call (`?user=`), a service
having no person of its own.
