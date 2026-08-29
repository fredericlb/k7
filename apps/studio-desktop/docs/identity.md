# Who the machine's workspaces belong to

The file service keys a person's workspace root on their **email**:
`~/.studio/root/<slug>/<workspace>`, with `slugify` replacing every non-alphanumeric character
by `_`. Hosted, that email comes from OIDC. Offline there is nobody to ask.

So the desktop app **remembers** one — `identity` in `~/.studio/engine-tray.json`, chosen on
first launch as `<os-username>@localhost`. Not derived afresh each time, because the answer
names a directory and a second answer points at an empty one.

`@localhost` rather than a plausible domain, so it can never collide with an account somebody
actually has.

## `/auth/me` never 401s

`AuthGate` is st0's outermost gate and it reads three states off that one route: a 401 is
"anonymous" and draws a sign-in card; anything else that fails is "auth is down" and blocks the
whole tree behind a diagnosis. Neither is true here — the person is sitting at the machine.

So this origin always answers, with a user shaped exactly as `getMe` expects. `AuthGate` needs
no branch and st0 needs no change: it goes straight to `authed`.

`/auth/login` exists only so it is not a 404. A 404 would fall through to the SPA catch-all
and hand back `index.html`, so "sign in" would silently return the app — a stranger failure
than an error. It redirects, and refuses a `return_to` that is not same-origin.

## The hazard, which has no error message

Pair a server later and the identity becomes the account's email. The slug changes with it.
`listWorkspaces` then finds nothing under the new slug and — doing exactly what it should on a
new machine — bootstraps a fresh, empty `Examples`.

What the user sees is that their songs are gone. Nothing errored, nothing logged, and the app
looks like a clean install. `docs/rename-test-plan.md` already names `root/` as the one thing
that does not regenerate.

`adoptIdentity()` is the answer: it renames `root/<old>` to `root/<new>` and says so in the
merged log. Two limits, both deliberate:

- it moves only when the old root exists and the new one does **not**. Two real roots is a
  merge, and a merge is a decision for the person who has both — so it logs that both are
  there and leaves them alone;
- it adopts the identity either way. The user asked for it, and refusing would leave the
  server paired and the identity stale, which is the confusing half of both worlds.

`src/server/identity.test.ts` covers all four paths, including the one where nothing moves.
