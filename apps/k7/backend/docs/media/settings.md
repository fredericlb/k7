# The hunt's settings — stored, sealed, tested

What "Find songs" ([hunt.md](hunt.md)) needs to reach the slskd daemon and bring the bytes back:
its address, its API key, and the SFTP access to the machine it downloads onto. The form is a card
of k7's server page, `/settings/server` (`packages/ui-library/docs/settings.md`); this page is what
the backend does with it, under `/api/settings`.

## One for the instance, not one per person

The slskd address, its API key and the SFTP access belong to the **instance**: one daemon, one
download folder, and every hunt, whoever starts it, goes through them. Anyone signed in can start a
hunt, but only an **admin** — the session's `groups` against `$AUTH_ADMIN_GROUPS`, the same reading
as the libraries' (`apps/k7/backend/src/media/admin.ts`) — can read, change or test them: whoever
can move the address can send the stored key wherever they point it. The hunt history stays per
person; only what it runs through is shared. A new instance is unconfigured, and the hunt screen says so and
links to the settings.

Nothing about slskd comes from the environment: a form changes a key without a restart, and can
test what it saved.

## On the volume, one file

`.settings/slskd.json` on the library volume — the same dot-directory rule as `.hunts/` and
`.shares/`, so no family scan walks it. The library has no database for this, and one small file is
all it needs. `STUDIO_SETTINGS_DIR` moves it, for tests.

## The secrets are sealed, and never sent back

The API key, the SFTP password, the private key and its passphrase are **sealed** in that file
(AES-256-GCM, `apps/k7/backend/src/media/settings/secret.ts`), not hashed: a hunt runs in the
background, with nobody there to retype them, so the plain text has to come back. The key is
derived from `SESSION_SECRET`. Rotating it makes every sealed secret unreadable, and an unreadable
secret counts as **none on file**: the screen shows it missing and it is typed again. Nothing worse.

`GET` answers every plain field and, for each secret, only **whether one is on file**. `PUT` tells
"absent" (keep) from `""` (forget), which is what lets a form leave a secret field empty without
erasing what is stored.

A kept secret stays bound to the target it was typed for. When `url` changes, the API key is
dropped unless a new one comes with it; when the SFTP host, user or port changes, so is the
password. The private key and its passphrase are kept: SSH public-key authentication signs a
challenge and never sends the key, so a new host learns nothing it could reuse.

The private key is the key **itself**, pasted, not a path: the server has no file of the user's to
point at. It should be a key distinct from the git deploy key — reaching a git host and opening a
shell on the slskd machine are two different trusts.

## Saving tests

Saving tests what was saved, and the test can also run alone. Both halves are tried at once and
reported apart — slskd (`GET /application` with the key) and SFTP (sign in and list the download
folder) — because a form of eight fields is filled in to find out whether it works, and the two
fail for unrelated reasons. The test reads the SAVED settings, not the form, so a secret on file is
tested without ever travelling back to the browser.

A failed half answers a fixed sentence and the cause goes to the server's log. The raw error —
"connection refused", a TLS name, a status line — would turn the test into a probe of whatever
address the form names.

The routes are **session only**, like `/api/hunt`: a machine token must not read or replace the
credentials a hunt spends. One of them answers anyone signed in: `GET /api/settings/admin`, whether
the session is an admin, which k7's user menu asks before it offers the server page. It says
nothing about the settings, and every other route still checks for itself.

A hunt reads the settings **once, when it starts**: saving mid-hunt changes the next one.
