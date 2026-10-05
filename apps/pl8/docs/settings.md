# Settings

« Paramètres » is a page, reached from the user menu's row under the email, as in st0 and k7
(`packages/ui-user-menu/docs/userMenu.md`). It holds who is signed in (with the sign-out button),
the **engines** registered here, and the instance's **slskd settings** — what "Find songs"
([hunt.md](hunt.md)) needs to reach the daemon and bring the bytes back.

## « Moteurs » — the engines this registry holds

This pl8 is THE engine registry: st0 and z0 list their engines from it too
(`packages/engine-registry/docs/shared.md`). The card lists every engine registered here — the
machine's name, the id's first eight characters, and the one this account's pl8 has **chosen**.

Each row is **measured from this browser** (`engines.find`, the same probe the player runs), not
just listed: registered and reachable-from-here are two different facts, and « injoignable depuis
ce navigateur » is the one that explains an empty player. An engine in use says by whom and on
what, rather than just « occupé ». « Actualiser » looks again.

It is read-only. An engine is connected from its OWN machine — the tray's **st0 instances** tab,
with this instance's address — because that is where its token lives; the empty card says exactly
that, with the address to type. Nothing here can register, drop or pick an engine for anyone.

## One for the instance, not one per person

The slskd address, its API key and the SFTP access belong to the **pl8 instance**: one daemon,
one download folder, and every hunt, whoever starts it, goes through them. Anyone signed in can
read and change them — the same people who can already start a hunt. The hunt history stays per
person; only what it runs through is shared. A new instance is unconfigured, and the hunt screen
says so and links here.

Nothing about slskd comes from the environment: a form changes a key without a restart, and can
test what it saved.

## On the volume, one file

`.settings/slskd.json` on the library volume — the same dot-directory rule as `.prefs/` and
`.hunts/`, so no family scan walks it. pl8 has no database for this, and one small file is all it
needs. `STUDIO_SETTINGS_DIR` moves it, for tests.

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
