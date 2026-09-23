# Settings

« Paramètres » is a page, reached from the cog in the header, as k7's is. It holds who is signed
in (with the sign-out button, which is why the cog opens a page rather than a menu) and each
person's **slskd settings** — what "Find songs" ([hunt.md](hunt.md)) needs to reach the daemon
and bring the bytes back.

## Per person, not per deployment

The slskd address, its API key and the SFTP access are **one person's**, stored against their
`sub`, like the hunt history they drive. A hunt spends an account's bandwidth and reputation on a
third-party network, so the account it spends is the one the person set up — not one the
deployment chose for everyone. A new account is unconfigured, and the hunt screen says so and
links here.

Nothing about slskd comes from the environment: a form changes a key without a restart, and can
test what it saved.

## On the volume, one file per person

`.settings/<slug>-<hash>.json` on the library volume, through `@studio/user-prefs`'s `prefsStore` —
the same naming and the same dot-directory rule as `.prefs/` and `.hunts/`, so no family scan
walks it. pl8 has no database for this, and one small file per person is all it needs.
`STUDIO_SETTINGS_DIR` moves it, for tests.

## The secrets are sealed, and never sent back

The API key, the SFTP password, the private key and its passphrase are **sealed** in that file
(AES-256-GCM, `backend/src/settings/secret.ts`), not hashed: a hunt runs in the background, with
nobody there to retype them, so the plain text has to come back. The key is derived from
`SESSION_SECRET`. Rotating it makes every sealed secret unreadable, and an unreadable secret
counts as **none on file**: the screen shows it missing and it is typed again. Nothing worse.

`GET` answers every plain field and, for each secret, only **whether one is on file**. The form
leaves a secret field empty; typing replaces it, « Oublier » clears it, and leaving it alone keeps
it — which is why `PUT` tells "absent" (keep) from `""` (forget).

The private key is the key **itself**, pasted, not a path: the server has no file of the user's to
point at. It should be a key distinct from the git deploy key — reaching a git host and opening a
shell on the slskd machine are two different trusts.

## Saving tests

« Enregistrer » saves, then tests what was saved, and « Tester la connexion » does the test alone.
Both halves are tried at once and reported apart — slskd (`GET /application` with the key) and SFTP
(sign in and list the download folder) — because a form of eight fields is filled in to find out
whether it works, and the two fail for unrelated reasons. The test reads the SAVED settings, not
the form, so a secret on file is tested without ever travelling back to the browser.

The routes are **session only**, like `/api/hunt`: a machine token must not read or replace the
credentials a hunt spends.

A hunt reads the settings **once, when it starts**: saving mid-hunt changes the next one.
