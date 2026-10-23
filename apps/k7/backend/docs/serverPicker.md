# A paired machine browsing its server

On the tray, the sidebar's server picker (`apps/k7/frontend/docs/serverPicker.md`) lets the
Libraries, Media and Rehearsal pages read the account's paired server instead of this machine.
Two halves make it: the tray's backend forwards (`src/remote/forward.ts`), the server lets the
forward in (`src/remote/door.ts`).

## The page never talks to the server itself

The tray's page is `http://127.0.0.1:18789`. The server's CORS answers a list loopback is not on
(`media/cors.md`), and its session cookie would ride a cross-site request only as a third-party
cookie, which browsers block. So the page asks its own backend, under `/api/server`, and the
backend calls the server.

## The machine signs in with its device token

The forward carries the device token the account's pairing stored (`packages/file-hub/docs/syncRelay.md`),
the same credential the engine's heartbeat and the releases forward use
(`packages/rehearsal-server/docs/publications.md`). The server's door turns it into a session for
that one request — the person the token names, with the account's email — and hands the request to
the ordinary routes. No route is written twice, and each answers as it would in a browser there.

- **The token rides in `x-k7-device`, not `Authorization`.** The page's own file ticket and library
  bearer travel in `Authorization`, and go through untouched.
- **The door's session carries no groups.** Nothing the server keeps proves a device's person is an
  admin, so what an admin alone may do — adding a library to the origin's list — still needs the
  server's own page.
- **A token that names no person is refused** with `reason: "repair"`: pairing again mints one that does.

## Only what the pages need passes

The door lets through the médiathèque, its hunt, the rehearsal recorder and the account's files
(`ALLOWED`). What mints or pairs — tokens, devices, pairings — and the slskd settings, which hold the
daemon's key, stay behind a real session (`media/settings.md`). A dot segment in the path is
refused, so a path cannot climb out of an allowed prefix.

The hunt crosses because songs are found on the server whose library they land in, and the door's
request is the person's own, from their page on their machine: it is the headless SERVICE token the
hunt refuses (`media/hunt.md`), and a device token names a person. It spends the server's Soulseek
access exactly as that person's browser on the server would.

## What does not cross

- **The rehearsal recorder's live link** (`/rtc`) is a WebSocket, which the forward does not carry.
- **This machine's own routes** stay on this backend whatever the choice: the engine registry, the
  slskd settings and the copies placed against the server (`hostBase` in each UI package).
