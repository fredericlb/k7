# Engine access: who may use an engine, without asking anyone

The decisions of the engine-access work, in one place. What is built is described by
`../packages/engine-registry/docs/ownership.md`, `../engine/k7-runtime/docs/pairing.md` and
`../engine/k7-supervisor/docs/supervisorPolicy.md`; this page says the whole design and which lots
remain.

## The goal

- **The same machine needs nothing.** Anything signed in on a backend whose engine runs on that
  very machine may use it — the tray, the phone, a dev session, a server's own engine.
- **The LAN needs nothing, by default.** A device on the engine's network uses it without pairing.
  An engine setting, **Available on the LAN**, turned off, puts pairing back as it is today.
- **Adding a server makes the engine yours there.** Whoever adds a server owns the engine on it
  from the first heartbeat, with no direct open and no approval.
- **The owner shares it there**: with accounts named by email, or with **everyone** on that server.

## What forces each choice

### Ownership comes from the heartbeat, never from an open

Today an engine belongs to the first account that opens it with its token. That is how a dev
session's stub account (`dev@example.com`) came to own a musician's engine: whoever was signed in
in the browser on that machine, not the person who added the server. So **the owner is the account
the heartbeat proves**, through the device token that server minted for it. An open enrols
nobody, and an engine whose heartbeat proves no account is never owned: it is usable only by the
rules below that need no owner (same machine, LAN), and is otherwise listed as unowned and
unusable through the relay.

A proven heartbeat for another account than the recorded owner reassigns the engine, and drops
the old owner's claims and shares: the machine's own credential is the stronger statement.

The registry gets an account slug from `deviceOf`; the owner and the shares are emails. The slug's
folder holds `owner.json` with that email, so the file hub answers the email, never the slug.

### The same machine is one rule, on every backend

`localMachine` already makes a loopback engine `owner` to every account on the tray's and the
phone's backend. It becomes the rule everywhere: an engine whose heartbeat comes from loopback is
usable by every signed-in account of that backend. On a hosted server a loopback engine is the
server's own anyway, and in a dev session it is the developer's — which is also what lets the
functional suite's account (`e2e@st0.app`) use the dev machine's engine with no share.

### The LAN is the engine's decision, not the server's

A LAN device reaches the engine directly, never through a registry, so the setting lives in the
supervisor's `engine-host.json` (`lanOpen`, default `true`) and the engine applies it: open, an
unpaired private-address peer gets `whoami` with the token as a loopback peer does; closed, it
gets `needsPairing` as today. Pairing approval, denial and revocation stay refused over the LAN
either way. The setting is shown on the engine's settings page, on the machine itself, and changed
through the supervisor's command allow-list.

Open by default is accepted on purpose: a home or rehearsal-room network is the case the product
is for, and a café network is the case the switch is for.

### One Servers list

Two screens add a server today: Studios (the engine starts heartbeating) and Sync servers (the
account pairs and gets a device token). Owning needs both — the heartbeat AND the account it
proves — so they become one list: adding a server signs in on it in the browser, mints the device
token for that account, hands it to the supervisor with the URL, and the first heartbeat carries it.
Removing a server stops the heartbeats and forgets the token.

### Everyone is a flag, not a list

"Shared with everyone" is `everyone: true` on the engine's record, beside the email list, so a
new account on the server is included without the owner editing anything. A shared engine is still
claimed by one project at a time; the claim rules do not change.

## Lots

1. **Registry**: ownership from the proven heartbeat (slug → email), no enrolment on open,
   reassignment, `everyone`, the loopback rule on every backend. Unit tests in
   `packages/engine-registry`.
2. **Engine and supervisor**: `lanOpen` in `Settings.h/.cpp`, passed to the engine, applied in
   `ServePairing.cpp`; a supervisor command to set it, on the backend's allow-list.
3. **One Servers list**: the add flow mints the device token and passes it with the URL
   (`weburi.add <url> <token>`), on the tray and the phone; Studios and Sync servers merged.
4. **Screens**: the LAN switch on the engine page; Everyone beside the email list in
   `EngineShareEditor`.
5. **Docs and the functional suite**: `ownership.md`, `pairing.md`, `e2e/docs/e2e.md`, and the
   rehearsal stems spec running with no share.

## Open questions

- An owner recorded by an open before this change is kept until a proven heartbeat names another
  account; nothing new is ever owned without one. So an engine whose machine proves nothing stays
  with whoever opened it first — dropping those records instead would strand engines nobody can
  re-own until their supervisor holds a token.
- What a LAN device sees of a closed engine on a page served over HTTPS is unchanged: `ws://` to a
  private address is mixed content there, so the LAN rule serves plain-HTTP pages and the apps.
