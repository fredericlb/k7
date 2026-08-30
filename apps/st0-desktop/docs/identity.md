# Who the machine's workspaces belong to

The workspaces are `<state>/workspace/<workspace>`, with nobody underneath: one machine holds
one person's (`packages/engine-client/docs/paths.md`). The identity is still needed — it names
the engine SESSION, the SSH key folder, and the user st0's `AuthGate` draws. Hosted, it comes
from OIDC. Offline there is nobody to ask.

So the desktop app **remembers** one — `identity` in `<state>/engine-host.json`, chosen on
first launch as `<os-username>@localhost`. Not derived afresh each time, because a second
answer would be a second session, and the project loaded in the first would go quiet.

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

## The hazard this file was written for, and why it is gone

Workspaces used to live under `root/<slug>/`, the slug being the identity. Pair a server later
and the identity became the account's email, the slug changed with it, `listWorkspaces` found
nothing under the new one and — doing exactly what it should on a new machine — bootstrapped a
fresh, empty `Examples`.

What the user saw was that their songs were gone. Nothing errored, nothing logged, and the app
looked like a clean install. `adoptIdentity()` answered it by RENAMING `root/<old>` to
`root/<new>`, with a rule about what to do when both existed and a rule about adopting anyway.

There is no slug in the tree now, so there is nothing to rename and nothing to get wrong.
`adoptIdentity()` remains, and does one thing: it saves the identity. It still returns
`{ moved: false }` because a caller reads that shape, and it is now always false.

The lesson worth keeping is the one that made the bug invisible: **a directory named after a
value that can change is a silent failure waiting for the value to change.** The engine session
is still named after the identity — but a session is not a directory, and a wrong one is loud
within a tick (`packages/engine-protocol/docs/sessions.md`).

`src/server/identity.test.ts` covers it, including that the workspaces stay put.
