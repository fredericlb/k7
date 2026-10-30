# The WebSocket upgrades: one rule in front of the listeners

Five parts of this backend take a WebSocket upgrade on the shared HTTP server, each on its own
`upgrade` listener: the engine relay (`/api/engine/<id>/ws`), the engines' tunnels
(`/api/engine-tunnel`), the sync relay (`/api/sync`), the remote cameras (`/api/cameras/ws`), and a
share's player (`/api/public/share/<id>/play`). An upgrade skips Express, so none of Express's
fallbacks or error handling reaches them.

Each listener ignores a path that is not its own, as it must, since every listener hears every
upgrade. Node closes an unclaimed upgrade only when no listener exists at all. So with five, an upgrade
on any other path is left open: never answered, never closed. That has two costs:

- **A client waits for good.** A socket the server routes nowhere looks, from the page, like a
  server that is slow to answer, so nothing on the page ever reports a failure.
- **A reset ends the process.** Once an upgrade is detached from Node's HTTP handling, nothing
  listens for the socket's errors, and a client that goes away with a reset (a closed tab, a phone
  changing network) throws an uncaught `ECONNRESET`. The backend exits on an uncaught exception, so
  a server is restarted by its container, but the tray and the phone are left without their backend.

`src/upgradeGuard.ts` answers both, ahead of every listener:

- Every connection gets an error listener when it is accepted. A connection, not an upgrade:
  the sync relay re-wraps the upgrade listeners when it starts, so an error listener put on the
  upgrade would depend on the order the parts started in.
- An upgrade on a path none of the five serves gets a `404` and is closed at once.

The five paths are listed in one place (`SERVED_UPGRADES`), from each part's own constant. A part
that takes a new upgrade path adds it there, or its sockets are refused; `upgradeGuard.test.ts`
names every one.
