# Per-user preferences: a file, not a database

One JSON per user on a volume, keyed by the OIDC subject. It exists because the hosted side
of studio remembered **nothing** about a person: l8' engine pick lived in `sessionStorage`
(so a second tab lost it), the médiathèque had no settings screen at all, and
`~/.studio/preferences.yaml` — the one thing that looks like this — is per-MACHINE, on the
engine's side of the wire, shared by every hosted user who selects that machine.

## Why a file

What is stored is one engine id per person. Losing it costs one click. That is the whole
risk budget, and it does not buy a database:

- l8-backend and pl8-backend have **no database dependency today**. Adding Grist to
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

`preferencesRouter(store, schema)` takes the shape from whoever mounts it. l8 and the
médiathèque remember different things, and a union of every service's fields would be a
shape no service actually has.

### …and it is a GATE, which is not obvious and cost a feature

A zod object **strips what it does not declare**, silently and by default. So a service whose
schema has fallen behind its frontend accepts a write, answers `{ok:true}`, and stores less than
it was handed — and the browser, holding the whole object in memory, sees nothing wrong until the
next load.

l8 lost its entire command layer that way. Renaming a command worked, the page said it had saved,
and a reload showed the catalogue's own names again: `L8Prefs` had grown a `commands` field in the
browser while `prefsSchema` still read `z.object({ engineId: z.string().optional() })` under a
comment that said *one field so far*. On disk there was only ever the engine id.

`droppedKeys` is the answer, and it is deliberately a **refusal** rather than a passthrough:

- a write whose top-level keys do not all survive the parse comes back **400**, naming them —
  *this service does not store `commands`*;
- so the missing declaration is found the first time anyone saves, by whoever is looking at it,
  instead of on somebody's next reload with nothing to point at.

Passing unknown keys through would have been the other way to make the bug impossible, and it is
worse: a typo'd field would then be stored for ever, and the schema would stop meaning anything.
The host's schema is the contract; this only stops it failing in silence.

**Adding a preference is therefore two edits**: the type the browser widens, and the schema the
service declares. There is no way to arrange one place — the backend is a separate build and the
frontend is a browser bundle — so the check is what holds them together.

The router does not authenticate. It reads `req.user.sub`, which the host's `requireAuth`
guarantees — mount it behind one.
