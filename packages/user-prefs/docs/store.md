# Per-user preferences: a file, not a database

One JSON per user on a volume, keyed by the OIDC subject. It exists because nothing else on the
hosted side remembers anything **about a person**: without it st0's engine pick lives in
`sessionStorage`, where a second tab does not see it, and `~/.studio/preferences.yaml` — the one
thing that looks like this — is per-MACHINE, on the engine's side of the wire, shared by every
hosted user who selects that machine.

## Why a file

What is stored is one engine id per person. Losing it costs one click. That is the whole
risk budget, and it does not buy a database:

- st0-backend and pl8-backend have **no database dependency today**. Adding Grist to
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
which is the difference between "two users share a preference" and "they don't". The slug puts
the recognisable part back without being what makes the name unique.

**There is no dot in the allowed set**, and that is not fussiness. Allowing one lets
`../../etc/passwd` slug to `.._.._etc_passwd`. That is harmless *here* — the separators are gone,
so no traversal is left — but "harmless because of a second rule" is the shape of the bug that
comes back the day the second rule moves. A subject reads perfectly well without dots.

## Two failure modes, both deliberate

**A read never throws.** An absent file, a truncated one, or an unmounted volume all read as
*this user has no preferences* — the ordinary first-login state the caller already handles.
A hosted service must not 500 because a volume is missing.

**A write that fails never throws, and says so.** `write` answers a boolean rather than
raising: the choice the person just made still stands for this session, because taking it away
*as well* would be strictly worse from where they are standing. What is lost is only that it
outlives the session — and that is worth one sentence, so the route answers 500 with it rather
than `{ok:true}`.

The earlier shape here was a silent no-op with a cheerful `{ok:true}`, and it failed the same
way `droppedKeys` below describes: the gesture works, the page says it saved, and a reload shows
the old value back with nothing anywhere to point at. Same bug, same answer — refuse in words,
keep the behaviour.

## Writes are wholesale

The browser holds the whole object and PUTs it back. A merge would make a field impossible
to clear — you could pick an engine and never un-pick one.

## The schema belongs to the host

`preferencesRouter(store, schema)` takes the shape from whoever mounts it. st0 and the
médiathèque remember different things, and a union of every service's fields would be a
shape no service actually has.

### …and it is a GATE, which is not obvious

A zod object **strips what it does not declare**, silently and by default. So a service whose
schema has fallen behind its frontend accepts a write, answers `{ok:true}`, and stores less than
it was handed — and the browser, holding the whole object in memory, sees nothing wrong until the
next load.

That is a whole feature disappearing with no error anywhere: the gesture works, the page says it
saved, and a reload shows the old values back. The shape to look for is a field the browser's type
has and the service's schema has not — the disk then holds only what the schema declares.

`droppedKeys` is the answer, and it is deliberately a **refusal** rather than a passthrough:

- a write whose top-level keys do not all survive the parse comes back **400**, naming them —
  *this service does not store `commands`*;
- so the missing declaration is found the first time anyone saves, by whoever is looking at it,
  instead of on somebody's next reload with nothing to point at.

Passing unknown keys through is the other way to make the bug impossible, and it is
worse: a typo'd field would then be stored for ever, and the schema would stop meaning anything.
The host's schema is the contract; this only stops it failing in silence.

**Adding a preference is therefore two edits**: the type the browser widens, and the schema the
service declares. There is no way to arrange one place — the backend is a separate build and the
frontend is a browser bundle — so the check is what holds them together.

The router does not authenticate. It reads `req.user.sub`, which the host's `requireAuth`
guarantees — mount it behind one.
