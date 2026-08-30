# The key a service asked for — a route that no longer exists

`GET /api/projects/ssh-key/private?user=…` is gone, with the rest of pl8's knowledge of git.

It existed for one delicate reason, worth keeping written down because the shape recurs: a machine
holds a SERVICE's token, a service has no key, and the key was filed under a person's OIDC subject
— so the route accepted a service token naming somebody, and pl8 held the `email → subject`
directory linking the two spellings.

**None of it is needed now.** The file service makes its own key
(`packages/file-service/src/sshKeys.ts`) and it never leaves the machine, so there is no caller, no
naming problem, and no private half in flight. `packages/git-repos/docs/keys.md` has what that
changed.

The directory itself survived — `apps/pl8/backend/src/projects/identities.ts` — because the shares
need it. That is identity, and it never was git.
