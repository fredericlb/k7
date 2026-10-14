# Pairing a device with an engine

An engine answers its own machine — and the server's relay, which reaches it as the machine — without
asking anything. A phone, a tablet or another computer reaching it over the local network has to be
paired first, once. What the engine decides and why is `engine/st0-engine/docs/pairing.md`; this page
is what st0 draws around it.

## Where the request is made

On the device, in the two places that look for an engine: the engine picker (`components/EngineSelect.tsx`)
and the second-device menu at `/external` (`components/ExternalIndex.tsx`). The card
(`pairing/PairThisDevice.tsx`) is drawn **only while no engine is usable**. A device that already has
an engine to play on is not interrupted by another one asking to be paired with it; a device with none
is told exactly why, rather than "no engine answers", which would be false.

A revoked device needs nothing of its own: the probe forgets a key the engine refused, so the engine
reads as unpaired again and the same card comes back.

Once paired, the picker goes straight to that engine. Making the person press **Use** after having
just walked to the machine and back is a step with nothing to decide.

## Where it is answered

On the machine, in two places, and the engine's list is the only state either keeps:

- **The editor**, as cards in the top-right corner (`pairing/PairRequestsPrompt.tsx`). Not a modal:
  the person at the machine may be in the middle of a take, and a request that waits two minutes can
  wait for them. A card leaves when the engine's list drops it, whoever answered — the app's own panel, another tab,
  the settings page, or the clock.
- **`/settings`**, the Paired devices section (`settings/PairedDevicesSection.tsx`): the same requests,
  and the paired devices with Revoke. It is the only place a device is revoked from a browser, since
  revoking is done rarely and on purpose — the reasoning that made settings a page (`settings.md`).

The code is shown on both sides, big on the device and on every card, because approving is the one
moment a stranger on the same network could slip in: the person approves the code they can see on
the device in their hand.

## From anywhere else

Only the machine may manage pairings. Elsewhere the engine refuses, and the settings section says
where to go instead of showing an empty list, which would read as "nothing is paired". The editor
asks every engine for its requests and ignores that refusal, since it is the expected answer on a
LAN device rather than trouble worth a line in the log.
