# Gate.tsx — extended notes

## Why this app has one gate and pistes has three

pistes stacks `AuthGate → EngineGate → WorkspaceGate`. The mediatek needs the first two
ideas and none of the third:

- **Auth**, because the file service identifies a caller by email (`x-studio-user`) and
  the registry routes are session-protected. Without a session there is nothing to send.
- **An engine**, because the library lives on the engine's machine and the only way to
  learn that machine's address is the registry plus a probe.
- **No workspace.** The mediatek is per MACHINE. The routes are mounted before
  `resolveWorkspace` and never read the header — which is why `api.ts` sends it empty
  rather than inventing a name.

## Why it does NOT take the engine lease

pistes' `EngineGate` renews an assignment on an interval and beacons a release on
`pagehide`. That lease is what drives the "in use" badge, and it is **per engine, across
users** — not per workspace, not per tab.

This app plays nothing. Taking the lease would mean a catalogue left open in a background
tab reports the engine as busy to whoever actually wants to make sound with it, and the
two apps would then fight over it every renewal interval. So the gate probes, takes the
address, and claims nothing.

That the lease is coarse enough to make this a real problem is worth writing down: it is
the first place the registry model shows its age, and it will show it again when platines
arrives.

## Why the nearest engine is taken without asking

pistes shows a picker because a musician may have several machines and cares which one
makes the sound. Reading a catalogue has no such stake: the gate takes the lowest tier
that answered and gets out of the way. Tier 3 — registered but unreachable from this
browser — is not a usable link and counts as no engine at all.

If that turns out to be wrong (two machines with different libraries), the picker to add
is pistes' `EngineSelect`, which is already framework-agnostic enough to lift.

## No StrictMode

`main.tsx` renders without it, matching pistes. Here the reason is narrower: the probe
opens real WebSockets to every advertised address, and a double mount doubles them for
nothing.
