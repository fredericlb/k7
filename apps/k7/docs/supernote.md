# Pushing the songbook to a Supernote

A toggle on the settings screen, three fields, and from then on the songbook lands on the
device by itself: one EPUB per song in `Document/Songbook`, on activation and once an hour.
It is the whole songbook as the user sees it — the shared book plus their own private songs — not
their favourites: the device is a copy of the book they play from ([ownership.md](ownership.md)).

## Why the protocol, and not WebDAV or a cloud

Ratta publishes no API. What exists is the protocol their own devices speak, described by a
community OpenAPI specification, and that is what a **Private Cloud** — Ratta's sync backend,
self-hosted from their Docker image — answers on the owner's own network.

That is the seam this uses, and the alternatives lost for reasons worth keeping:

- **NetVirtualDisk (WebDAV)** would make k7 serve a folder the device mounts. It would need
  k7 to hold a credential of its own — the app mounts no auth routes today, it only verifies
  st0's cookie, and an e-ink reader cannot do OIDC. A mounted disk is also read over the
  network rather than copied onto the device.
- **Supernote's hosted cloud** would mean a reverse-engineered client against somebody
  else's server, with the account's real password in a hosted service.
- **A dedicated account** on the private cloud is impossible, not merely unwise: a device
  syncs ONE account, so books left in any other are books it will never see. k7 therefore
  signs in as the owner, which is what makes the sealed password below necessary.

## The password is sealed, not hashed

The sync signs in every hour with nobody watching, so the plain text has to come back:
AES-256-GCM under a key derived from `SUPERNOTE_SECRET` (falling back to the session
secret). Losing that secret costs a re-activation and nothing else. It is the one column
of `SupernoteSync` that is not readable, it never leaves the backend, and switching the
toggle off forgets it while keeping the address and the account.

Activation **signs in before storing anything**: credentials that do not work are refused
at the button rather than discovered an hour later in a log.

## What decides that a song must be re-uploaded

The hash of the song's **text**, not of the book. A generated EPUB carries a fresh uuid and
the date it was built, so its bytes differ on every run — hashing those would push the whole
songbook every hour, forever. `Pushed` holds song uid → hash of what the song is made of.

The book's **stylesheet is in that hash too**, and has to be: it is not part of any song, so
changing the type size would otherwise reach no device already holding the old book, and every
run would keep reporting the songbook unchanged. Restyling therefore costs one full re-push,
which is the honest price.

A song is also re-pushed when its file is missing from the remote folder, which is what lets
deleting a book on the device bring it back.

The name comes from `@k7/shared/naming`, shared with the browser's zip export on purpose:
two naming rules would mean the hourly run pushing a second copy of every song. A changed
song's old file is **deleted before** the new one goes up, because the server keeps both
otherwise and the device would show the song twice.

That delete does not always win the race. **The server never lets a name be replaced**: an
upload arriving for a file it still holds is accepted, and the old one is kept under
`<name>_CONFLICT_<stamp>`. Measured, it happened to one song in ten. So a run ends by
sweeping those copies — of the names it wrote and of no others — and it sweeps on **every**
run rather than only after an upload, since a copy left behind by an earlier one would
otherwise sit on the device forever, no quiet run ever looking for it.

## What the sync does not do

It never reads from the device, and it never deletes a book for a song that is gone from the
songbook — a folder you keep is yours, and a sync that removes things is a sync that loses
things.

## Notes on talking to the server

The protocol is JSON over POST, and an error comes back **200 with `success: false`**, so
nothing may be inferred from the HTTP status. Signing in is two calls: the server hands out a
one-shot code, and what travels is `sha256(md5(password) + code)`. Everything after that
carries `x-access-token`.

An upload is three calls — apply, post the bytes to the URL the server grants, then finish —
and `upload/apply` is the one that also wants `timestamp` and `nonce` headers.

**The URL it grants is not reachable as given when the server sits behind a path.** It is built
from the server's own idea of where it lives, so a private cloud proxied at
`/priv/supernote` hands out `https://host/api/oss/upload` and that address is a 404. Only the
path and the query of it are ours to keep; the rest comes from the address the user configured.
A server already answering under that prefix, or one at a root, is left untouched — which is
also what keeps a real object store, on a host of its own, working.

A run that fails says **why** and not merely how many: the first reason is carried into
`LastStatus` and shown under the buttons. The alternative is a count that sends the reader to
a log they have no way to open.

Every field name in `backend/src/supernote/client.ts` was taken from a running server rather
than guessed: a request missing a field is answered by naming it. `client.test.ts` pins those
names against a stubbed fetch, because a silent rename here is a sync that stops working
without failing.
