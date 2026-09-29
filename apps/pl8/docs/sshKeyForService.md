# A service token that names a person

A SERVICE token has no person behind it: its subject is `service:<name>`, minted by
`scripts/tokens.mjs` for a machine that calls this service headless. Data here is filed under a
person's OIDC **subject** — a share, for one — so a service acting for somebody must NAME them, and
it does so with `?user=<email>`. `routes/shares.ts`'s `owner()` is the one reader: a person's own
token ignores `?user=`, and only a `service:` subject may use it.

The email a caller knows and the subject data is filed under are two spellings of one person, and
`backend/src/projects/identities.ts` is the directory linking them. It is filled whenever a person
reaches this service with a session (`rememberIdentity`), so a service can only act for somebody
who has signed in here at least once — the safe direction for that to fail.

The bargain to keep in mind: whoever holds a service token can act for any person this directory
knows. That is why such a token is minted by hand, for a machine, and never by a route.
