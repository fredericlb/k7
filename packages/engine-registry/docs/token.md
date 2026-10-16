# The engine's credentials: the token, the tunnel secret, and what each one proves

An engine's supervisor holds three things in `<state>/engine-id.json`
(`engine/k7-supervisor/src/Identity.cpp`): an **id**, a **token** and a **tunnel secret**. They
are not three spellings of one credential. The token is readable by anyone who can reach the
engine; the tunnel secret is read by nothing but the supervisor and the registries it dials. The
file is the owner's alone — 0600, in a 0700 folder when the supervisor creates it.

## The token is not a secret

The engine answers `whoami` with its id, its token and its audio timing — to the machine's own
sockets, to the server's relay, and to a LAN device once it is PAIRED. An unpaired LAN peer gets the
id and `needsPairing` and never the token (`engine/k7-runtime/docs/pairing.md`):

```
// engine/k7-runtime/server/Serve.cpp, the `whoami` / `hello` branch
ws.send(json{{"type", "whoami"}, {"id", engineId}, {"token", engineToken}, …}.dump());
```

The relay forwards a `whoami` for any signed-in account, before it holds a claim (`proxy.md`), and
the browser keeps the token: it is what `select` takes to claim that engine
(`packages/engine-browser/src/probe.ts`). So **every account that can list an engine can read its
token.** What it proves is narrow: that a browser met this engine's process before selecting it.
It is an unguessable identifier, not an authentication.

## The tunnel secret is the machine's proof

The supervisor mints 32 random bytes once and keeps them beside the id. It sends them in two
places and nowhere else: the heartbeat's body (`tunnelSecret`), to a registry whose `hello` it has
checked first, and the `x-studio-tunnel-secret` header of the tunnel it dials. It never gives them
to the engine process, never logs them, and no engine message carries them, so no browser ever
sees them.

The registry binds an id to the **first** secret a heartbeat carries for it — trust on first use —
and keeps that binding on disk as `id → sha256(secret)` (`bindings.ts`, `engine-bindings.json` in
the state dir its host passes; k7's is `<mediatek>/.engines`). The binding outlives the 15 s expiry
of a listing and a restart of the backend, because those are exactly the gaps a lookalike would use.
From then on, for that id:

| arrives | answered |
|---|---|
| a heartbeat with the bound secret | listed — even with a new token, the secret being the proof |
| a heartbeat with another secret, or none | `403`, logged; the id stays unlisted until its own machine beats again |
| a tunnel with the bound secret | accepted; a live tunnel for the id is REPLACED (a reconnect) |
| a tunnel with another secret, or none | `403`, logged; a live tunnel for the id stays where it is |
| a deregister without the bound secret | `403`; the token alone does not unlist an engine |

The bindings are capped (`MAX_BINDINGS`), the least recently seen going first: an evicted id that
comes back is bound again on its next heartbeat. Copying `engine-id.json` to a second machine copies
the secret with it, and the two then fight over one id exactly as one machine would; give the copy a
fresh file instead.

## Legacy supervisors

A supervisor older than the secret sends none. Its heartbeat is still taken, its tunnel still opened
on the token, and the id is listed with `legacy: true` (`PublicEngine.legacy`). What it cannot do is
take an id already bound to a secret: a heartbeat or a tunnel without one is refused for a bound id,
whatever token it carries.

An unbound, legacy id is protected the way every id once was: the first token seen pins it while it
is listed, and is freed 15 s after its last heartbeat. Since the token is readable through the
relay, **a legacy engine can be impersonated** by an account that read its token — its tunnel taken
over, or its id bound to somebody else's secret once its listing lapses. Updating the supervisor is
what closes that: its first heartbeat with a secret binds the id, using the token the id already
holds. The server's own engine is built from this tree and sends a secret like any other.

## What the token still gates

`select` checks it, so a claim names an engine the browser actually reached. The relay's server-side
dial shows it to the engine as the pairing key of a socket the server opened (`proxy.md`). Neither is
a defence against an account that can read it; the claim rules (`claim.md`) and the relay's gate are.

## The trust model, stated plainly

- **The musician's machine is trusted.** The engine, the supervisor and its files run there.
- **The local network is not**: a device on it drives once the musician has paired it, and the LAN
  path is unencrypted `ws://`, so a device that can sniff it sees a key or the token go by.
- **The server trusts a machine by its tunnel secret**, bound on first use.
- **A browser is trusted by its session**, the cookie k7 mints; through the relay it probes any
  listed engine and drives only one its account holds a claim on (`proxy.md`, `claim.md`).

See `docs/constat.md` for where this sits in the whole.
