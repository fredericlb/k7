# heartbeat.ts — reading a heartbeat without letting one odd field unlist an engine

An engine's supervisor POSTs `/registry/heartbeat` every 5 s; an entry that has not had one in
15 s (`REGISTRY_TTL_MS`) is gone. So a heartbeat REFUSED is an engine unlisted — and one that was
listed a moment ago stays in a browser's cached list, whose next `select` then fails.

## Only three fields can refuse one

`readHeartbeat` requires what there is no entry without: the **id**, the **token**, and
**`addresses.port`**, where the engine answers. A heartbeat missing one is refused with a 400 whose
body names the field (`heartbeat refused — token: …`), and the supervisor writes that body into its
`.studio.log`.

Everything else is CLEANED, and each cleaning is said:

| field | when it is odd | what is kept |
|---|---|---|
| `hostname`, `machineFingerprint` | not a string | empty (a hostname is cut at 255) |
| `addresses.loopback` | not IPv4 | `127.0.0.1` |
| `addresses.lanIps` | an entry not IPv4 | the others |
| `performance` | any figure out of its bounds | no performance at all — the picker shows no rating |

The cleanings come back in the answer (`{ ok: true, cleaned: [...] }`) and go into this server's
log. The bounds themselves are unchanged — the route is open, and a rating is a hint for a picker,
never a number to trust blindly — but a figure out of them now costs the rating, not the listing.

It was one strict schema until a Windows machine was listed once and then refused on every beat:
one figure its first heartbeat did not carry (performance is measured after the engine starts)
failed the schema on every heartbeat after, the entry lapsed, and a play answered "unknown engine or
bad token" with nothing in either log to say why.

## What is logged here

`[registry] …` on this server's output, at most once a minute per engine and per complaint
(`throttledLog`), since a refused machine retries every 5 s:

- a heartbeat refused, and why;
- a heartbeat taken with fields cleaned, and which;
- a token mismatch (409) — another process registered this id with another token; the id is freed
  15 s after that one's last heartbeat;
- a `select` refused.

## `select` tells its two refusals apart

`404 engine gone` when there is no live entry — the engine's machine has not had a heartbeat
accepted in 15 s, and its `.studio.log` says why. `403 bad token` when there is one and the token
the browser got from the engine's `whoami` is not the one it registered with. Two answers and not
one 403, because a single one sends the reader to the token when the cause is the heartbeat.
