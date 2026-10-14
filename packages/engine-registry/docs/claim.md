# The claim — which project runs where, and who has it

A claim carries a **project** and a **holder**, and the registry enforces three rules. A bare
"somebody is on this machine" timestamp, refusing nobody, is not enough the moment two people
can open the same project: nothing anywhere says they cannot, and the two halves that then
fight are not visible from either browser.

## The three rules

**1. One engine per project.** Opening a project that is already open somewhere takes it from
whoever had it. This is the rule people ask for, and the one whose absence reads as "the
engine is unstable": two browsers driving one project drive one `Edit` through two sessions
that each believe they own it.

Read that last clause carefully, because it is the whole rule and not a flourish: **two
sessions**. One account on one engine is ONE session — `sessionFor(<service>, email)`, one
project loaded in it (`packages/engine-protocol/docs/sessions.md`) — so its screens are not two
drivers of a project, they are one driver with two windows. Rule 1 exempts them: same account,
same engine, same project, no displacement.

That exemption is what makes an external surface possible at all. A tablet on
`<projet>/@external/desk` goes through the same gates as the editor and claims the same project,
and without it the laptop is thrown out of its own song — *"this project was opened
elsewhere"* — the moment the second screen opens. Two tabs of one song are the same case; the
surface is only where it becomes unmissable.

It is deliberately narrow. A different ACCOUNT on this engine is displaced, because that is two
people. The same account on a different ENGINE is displaced, because that is a second session and
the project really has moved machines. Only the two that share one loaded project are spared.

**2. One project per engine and SESSION.** Not tidiness. An account's file service serves one
project per engine session (`packages/file-service/src/engineLink.ts`, keyed by `sessionOf`), so a
second project in the same session does not coexist with the first, it clobbers it, and the symptom
lands somewhere else entirely (a take recorded into the wrong workspace, a transport that moves the
wrong song).

An account has two sessions k7 plays in: its song's and its **bench**'s
(`packages/engine-protocol/docs/sessions.md`). The registry tells them apart by the claimed address
— `claimSlot`, `@banc/…` being the bench — so an account's bench sits beside its own song on one
engine rather than taking the song's place. That is what lets the rehearsal recorder record through a library
chain while the song stays open (`packages/ui-rehearsal/docs/chainSource.md`). A different ACCOUNT still displaces
either: an engine serves one account at a time (`packages/file-hub/docs/fileHub.md`).

The list names every claim (`heldProjects`) beside the one a picker shows (`heldProject`, the song
before the bench), since a client looking for the bench must find it on an engine a song holds too.

**3. A claim with no project conflicts with nothing.** The media library drives an engine and opens no
project: it auditions modules and plays songs out of the médiathèque. It passes `project: null`,
which claims the engine as *in use* and competes for nothing. Without this exemption, looking at
the catalogue would take the song away from the k7 tab on the same machine — which is worse than
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
| `select` **without** a secret | an OPEN | always granted; mints a secret; displaces whoever held the project *elsewhere* (see rule 1's exemption), and whoever held a different project on that engine |
| `select` **with** a secret | a RENEWAL | granted while that secret is still registered; **409** once it is not |

A 409 is not a fault and must not be retried. It is the answer, and the browser turns it into
`ClaimLost` (`@studio/engine-browser/registry`) — its own type precisely so a caller can tell
"let go and say so" from "the network is down", which are opposite reactions.

### Three refusals, not one

The body carries `lost` alongside `heldBy`, because "somebody has the project" is only one of
the three ways a renewal comes back refused, and it is the least common:

| `lost` | what happened | body also carries |
|---|---|---|
| `project` | the SAME project was opened by somebody else, or by us on another engine | `heldBy` — whose it is now |
| `engine` | a DIFFERENT project took this engine (the second displacement rule above) | `heldBy`, and `tookFor` naming that project |
| `lapsed` | nobody took anything: the secret aged out over a sleep or a network gap, or the engine deregistered | nothing — `heldBy` is empty |

They exist because they are three different sentences on screen. "This project was opened
elsewhere, and a project runs on one engine at a time" is false for two of the three — and
actively misleading on `engine`, where the honest advice is the opposite: pick a second engine
and both projects can run. A backend that answers a bare 409 reads as `project`, which is what
that answer means.

A surface must not retry `project` or `engine`: somebody is holding what we asked for, and a
quiet re-claim would take a project out from under a person who is driving it — then be taken
back five seconds later, for ever.

`lapsed` is the one that IS retried, by the hold loop itself rather than by any surface. It is
answered only when nobody ELSE holds this project *and* no other project holds this engine, so
re-opening displaces nobody by construction — and the tab coming out of sleep is not asking for
anything it did not already have. Our own other screen does not turn that into a `project`: it
holds what we hold and took nothing, and the exemption above is what then lets the retry land
beside it rather than on top of it. `@studio/engine-browser`'s `holdEngine` drops the dead secret and re-opens
on its next tick; see [lease.md](../../engine-browser/docs/lease.md) for why the next tick and
not at once. Treated like the other two it would be a dead end on screen, telling someone to
re-open by hand a project nobody had taken from them.

`release` carries the same secret, not the engine token. A goodbye may only drop the hold it
actually has: with the engine token, a tab closing a second after being displaced would drop the
claim of whoever just took the project, and that person would read FREE in every picker while
still driving.

## What still expires on its own

Everything. The secret does not change that a holder is a browser tab, which can be closed,
crash, or be put to sleep, and cannot be relied on to say goodbye. `ENGINE_ASSIGN_TTL_MS`
(90 s, renewed every 5 s) is what forgets a holder nobody heard from — see
[lease.md](../../engine-browser/docs/lease.md) for the bug that shape exists to prevent.

Which means a crashed tab costs the next person a minute and a half, and never a lockout. That is
deliberate: a claim that needed clearing by hand would be a worse failure than the one it
prevents. The length is forced from below: a browser holds a background tab's timers to one tick
a minute, so anything shorter lets the lease of someone listening with the tab behind another
lapse, and the next person's gate takes the engine out from under the music. A tab that closes
normally releases at once on `pagehide`; only a crash waits the full TTL.

## Where each surface stands

| surface | project claimed | what it does when it loses one |
|---|---|---|
| k7 | `<repo>/<projet>` from the address | taken: `EngineGate` shows "opened elsewhere" and stops driving. Lapsed: nothing on screen — the hold loop re-opens |
| the media library | **none** (`null`) | nothing to lose — see rule 3 |

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
see `engine/k7-runtime/docs/sessions.md`.
