# The two settings cards

The package exports two cards from `@studio/ui-library/settings`, and k7's `/settings` page carries
them as sections of its own, beside the account's other settings: **Engines** — the engines
registered with this origin — and **slskd** — what "Find songs" ([hunt.md](hunt.md)) spends. The
library has no settings page of its own: one account, one page.

## Engines — the registry this origin holds

The origin's backend holds THE engine registry: the editor and z0 list their engines from it too
(`packages/engine-registry/docs/shared.md`). `src/EnginesSettings.tsx` lists every engine registered
there — the machine's name, the id's first eight characters, and the one this account has
**chosen**.

Each row is **measured from this browser** (`engines.find`, the same probe the player runs), not
just listed: registered and reachable-from-here are two different facts, and "unreachable from this
browser" is the one that explains an empty player. An engine in use says by whom and on what,
rather than just "busy". A refresh button looks again.

It is read-only. An engine is connected from its OWN machine — the instance's address in the command-line
engine's `registryUrls`, or the app's list of studios — because that is where its token lives; the empty card says exactly
that, with the address to type. Nothing here can register, drop or pick an engine for anyone.

## slskd — a form whose secrets never come back

`src/SlskdSettings.tsx` edits the instance's slskd and SFTP access. What the server stores, how the
secrets are sealed and what the test checks is
[apps/k7/backend/docs/media/settings.md](../../../apps/k7/backend/docs/media/settings.md).

A secret on file is never shown, only said to be there. The field stays empty; typing replaces the
secret, "Forget" clears it, and leaving it alone keeps it — the three answers the route tells apart.

Save saves, then tests what was saved; the test button tests alone. The two halves — slskd and
SFTP — are reported apart, because they fail for unrelated reasons and a form of eight fields is
filled in to find out which one works.
