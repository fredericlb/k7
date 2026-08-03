# Per-user preferences: a file, not a database

One JSON per user on a volume, keyed by the OIDC subject. It exists because the hosted side
of studio remembered **nothing** about a person: pistes' engine pick lived in `sessionStorage`
(so a second tab lost it), the médiathèque had no settings screen at all, and
`~/.studio/preferences.yaml` — the one thing that looks like this — is per-MACHINE, on the
engine's side of the wire, shared by every hosted user who selects that machine.

## Why a file

What is stored is one engine id per person. Losing it costs one click. That is the whole
risk budget, and it does not buy a database:

- pistes-backend and mediatek-backend have **no database dependency today**. Adding Grist to
  both, for a string, would be the largest dependency either has ever taken for the smallest
  fact either has ever stored.
- The médiathèque's own argument applies unchanged — *the filesystem is the index* — and it
  is already deployed on a volume for exactly that reason.

What it costs: a redeployed container with no volume mounted loses everyone's pick, and each
user re-chooses once. That is the trade, stated so nobody is surprised by it.

## The filename

`fileFor(sub)` is a readable slug **and** a hash of the full subject, because neither alone
is safe:

- A `sub` is an opaque string the IdP chooses. It can contain `/` or `..`, characters
  Windows forbids, or run past a name-length limit — it can never be a path segment as-is.
- A pure hash would be safe and leave a directory nobody can read.

The hash carries the uniqueness. Two subjects that slug identically get different files,
which is the difference between "two users share a preference" and "they don't".

## Two failure modes, both deliberate

**A read never throws.** An absent file, a truncated one, or an unmounted volume all read as
*this user has no preferences* — the ordinary first-login state the caller already handles.
A hosted service must not 500 because a volume is missing.

**A write that fails is silent, and the request still succeeds.** What is lost is that the
choice outlives the session. Failing the click would take the choice away *as well*, which
is strictly worse from where the user is standing.

## Writes are wholesale

The browser holds the whole object and PUTs it back. A merge would make a field impossible
to clear — you could pick an engine and never un-pick one.

## The schema belongs to the host

`preferencesRouter(store, schema)` takes the shape from whoever mounts it. pistes and the
médiathèque remember different things, and a union of every service's fields would be a
shape no service actually has.

The router does not authenticate. It reads `req.user.sub`, which the host's `requireAuth`
guarantees — mount it behind one.
