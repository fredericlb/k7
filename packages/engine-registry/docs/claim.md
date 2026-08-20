# The claim — which project runs where, and who has it

`select` used to mean one thing: "somebody is on this machine". It marked a timestamp and
refused nobody. That was enough while an engine was a machine you picked; it stopped being
enough the moment two people could open the same project, because nothing anywhere said they
could not — and the two halves that then fought are not visible from either browser.

A claim now carries a **project** and a **holder**, and the registry enforces three rules.

## The three rules

**1. One engine per project.** Opening a project that is already open somewhere takes it from
whoever had it. This is the rule people asked for, and the one whose absence produced "the
engine is unstable": two browsers driving one project drive one `Edit` through two sessions
that each believe they own it.

**2. One project per engine.** Not tidiness. The file service on that machine holds a **single**
active project — `packages/file-service/src/engineLink.ts` says so in its header, *"Several
browser tabs share it — last write wins"* — so a second project on one machine does not coexist
with the first, it clobbers it, and the symptom lands somewhere else entirely (a take recorded
into the wrong workspace, a transport that moves the wrong song).

**3. A claim with no project conflicts with nothing.** pl8 drives an engine and opens no
project: it auditions modules and plays songs out of the médiathèque. It passes `project: null`,
which claims the engine as *in use* and competes for nothing. Without this exemption, looking at
the catalogue would take the song away from the st0 tab on the same machine — which is worse than
the problem being fixed.

## Why a claim carries a secret

Because "the newcomer wins" and "the holder renews every five seconds" are the same call.

Without a secret, a displaced tab's next renewal is indistinguishable from a fresh open, so it
wins the project straight back — and five seconds later the other one does. One project, two
people, flickering between them for as long as both tabs are open, with the engine reloading it
each time.

So the two are told apart by the presence of `secret`:

| call | means | answer |
|---|---|---|
| `select` **without** a secret | an OPEN | always granted; mints a secret; displaces whoever held the project, and whoever held a different project on that engine |
| `select` **with** a secret | a RENEWAL | granted while that secret is still registered; **409** once it is not |

A 409 is not a fault and must not be retried. It is the answer, and the browser turns it into
`ClaimLost` (`@studio/engine-browser/registry`) — its own type precisely so a caller can tell
"let go and say so" from "the network is down", which are opposite reactions.

### Three refusals, not one

The body carries `lost` alongside `heldBy`, because "somebody has the project" is only one of
the three ways a renewal comes back refused, and it is the least common:

| `lost` | what happened | body also carries |
|---|---|---|
| `project` | the SAME project was opened, here or on another engine | `heldBy` — whose it is now |
| `engine` | a DIFFERENT project took this engine (the second displacement rule above) | `heldBy`, and `tookFor` naming that project |
| `lapsed` | nobody took anything: the secret aged out over a sleep or a network gap, or the engine deregistered | nothing — `heldBy` is empty |

They exist because they are three different sentences on screen. st0 said "this project was
opened elsewhere, and a project runs on one engine at a time" for all three, which is false
twice out of three — and actively misleading on `engine`, where the honest advice is the
opposite: pick a second engine and both projects can run. Older backends that answer a bare 409
still read as `project`, which is what they always meant.

A surface must not retry `project` or `engine`: somebody is holding what we asked for, and a
quiet re-claim would take a project out from under a person who is driving it — then be taken
back five seconds later, for ever.

`lapsed` is the one that IS retried, by the hold loop itself rather than by any surface. It is
answered only when nothing holds this project *and* nothing else holds this engine, so re-opening
displaces nobody by construction — and the tab coming out of sleep is not asking for anything it
did not already have. `@studio/engine-browser`'s `holdEngine` drops the dead secret and re-opens
on its next tick; see [lease.md](../../engine-browser/docs/lease.md) for why the next tick and
not at once. This was a dead end on screen until then, telling someone to go and re-open by hand
a project nobody had taken from them.

`release` carries the same secret, not the engine token. A goodbye may only drop the hold it
actually has: with the engine token, a tab closing a second after being displaced would drop the
claim of whoever just took the project, and that person would read FREE in every picker while
still driving.

## What still expires on its own

Everything. The secret does not change that a holder is a browser tab, which can be closed,
crash, or be put to sleep, and cannot be relied on to say goodbye. `ENGINE_ASSIGN_TTL_MS`
(15 s, renewed every 5 s) is what forgets a holder nobody heard from — see
[lease.md](../../engine-browser/docs/lease.md) for the bug that shape exists to prevent, which
two apps shipped independently.

Which means a crashed tab costs the next person fifteen seconds, and never a lockout. That is
deliberate: a claim that needed clearing by hand would be a worse failure than the one it
prevents.

## Where each surface stands

| surface | project claimed | what it does when it loses one |
|---|---|---|
| st0 | `<repo>/<projet>` from the address | taken: `EngineGate` shows "opened elsewhere" and stops driving. Lapsed: nothing on screen — the hold loop re-opens |
| pl8 | **none** (`null`) | nothing to lose — see rule 3 |

The address is turned into a claim key by `projectClaimKey` in
`@studio/web-protocol/projects`, beside the address vocabulary it comes from. One spelling, in
one place, because two surfaces spelling one project differently would each believe they had it
and rule 1 would hold for neither. It is `<repo>/<projet>` — the repository's short name and the
folder inside it — and never a workspace path, since the same repository is cloned somewhere
different on every machine.

## What this does NOT solve

The engine can still be driven by a client that never asks the registry at all. The claim is a
policy at the door, held by the surfaces; the engine itself accepts whatever arrives on its
socket. Closing that would mean the engine verifying a claim per session, which is a trust-model
decision and belongs with the rest of them (`docs/audit-moteur.md`, section B).

It also says nothing about a tab that goes away. That is the other half, and it is the engine's:
see `engine/moteur/docs/sessions.md`.
