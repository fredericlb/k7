# A service token that names a person

A SERVICE token has no person behind it: its subject is `service:<name>`, minted in code by the
process that hosts its caller — `service:k7`, for the rehearsal server st0's backend mounts
(`apps/st0/backend/src/server.ts`). Data here is filed under a
person's OIDC **subject** — a share, for one — so a service acting for somebody must NAME them, and
it does so with `?user=<email>`. `routes/shares.ts`'s `owner()` is the one reader: a person's own
token ignores `?user=`, and only a `service:` subject may use it.

The email a caller knows and the subject data is filed under are two spellings of one person, and
`apps/st0/backend/src/media/projects/identities.ts` is the directory linking them. It is filled whenever a person
reaches this service with a session (`rememberIdentity`), so a service can only act for somebody
who has signed in here at least once — the safe direction for that to fail.

The bargain to keep in mind: whoever holds a service token can act for any person this directory
knows. That is why such a token is minted in code, handed to a caller in the same process, and
never by a route — and why an account's file service gets a token whose subject is the account
instead (`packages/file-service/docs/mediatekLink.md`).
