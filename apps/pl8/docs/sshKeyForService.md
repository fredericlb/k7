# The private key, asked for by a machine on someone's behalf

`GET /api/projects/ssh-key/private` answers with the private half of the deploy key to the file
service on the engine's machine, which needs it to clone. This page says who may ask, and for
whom.

## The token's subject cannot be the owner

The token a machine holds is `scripts/tokens.mjs`'s, and its subject is `service:st0` — a
**service** identity, which has no key. Taking the subject as the owner would answer
`404 no SSH key yet` on every machine, sending people off to regenerate a key that is there.

## The rule

A **service** token must name the person (`?user=…`), and the name it gives is honoured. An
**account** token answers for itself.

The price is accepted: whoever holds a machine's token can ask for anyone's key. That is what
one credential per machine costs rather than one per person; the alternative is minting and
pasting an account token per machine, which needs an interface that does not exist and breaks
the test pinning `service:st0`.

What must not be relaxed:

- **bearer only**, never the session cookie: no page in any browser can be led into making this
  request, and no shape of CSRF applies;
- an account token naming another is **refused** (403), not ignored — answering with its own key
  would read as a success;
- a service token naming nobody is refused (400) rather than falling back to its own subject;
- `Cache-Control: no-store`, and the value is logged on neither side.

## The identity bridge

The two halves spell a person differently, and neither can adopt the other's without moving
directories that exist:

| | what it handles | why |
|---|---|---|
| the file service | the **email** (`x-studio-user`) | what the browser sends, and what its whole `<state>/workspace` tree depends on |
| pl8 | the **OIDC subject** | `subOf` takes `sub` first; everything here is filed under `fileFor(sub)` |

So pl8 keeps the directory: `projects/identities.ts` records `email → sub` as any authenticated
request of this section passes through — the one place both spellings are in hand at once, this
service verifying a session rather than minting one. A person whose key is asked for has
necessarily opened st0's home page to add the repository, so the directory knows them before a
machine names them.

`subFor()` falls back to the identifier given when the directory says nothing, which is not a
guess: where the IdP returns no email, `subOf` already uses the `sub` for both and the two
spellings are one string.

The write is best-effort — a read-only volume costs the bridge, never the request passing
through — and memoised in memory, because `/revision` is polled and a directory re-read per poll
is one file read per tick.

## Verified by

`src/routes/sshKey.test.ts`: the key answered to a service that names, the email's casing, the
subject taken raw, the 400 with no name, the 403 of an account aiming elsewhere, the 401 with no
bearer, the 404 when there is no key.
