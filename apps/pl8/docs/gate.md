# Gate.tsx — extended notes

## Why this app has one gate and l8 has three

l8 stacks `AuthGate → EngineGate → ProjectGate`. pl8 needs the first two ideas and
none of the third:

- **Auth**, because the file service identifies a caller by email (`x-studio-user`) and
  the registry routes are session-protected. Without a session there is nothing to send.
- **An engine**, because the library lives on the engine's machine and the only way to
  learn that machine's address is the registry plus a probe.
- **No workspace.** The library is per MACHINE. The routes are mounted before
  `resolveWorkspace` and never read the header — which is why `api.ts` sends it empty
  rather than inventing a name.

Note which way round that third one now runs. l8's gate no longer *picks* anything either:
this app owns the repositories and opens l8 on one project (see [projects.md](projects.md)),
so what used to be a workspace picker over there is a section over here.

## Why it does NOT take the engine lease

l8' `EngineGate` renews an assignment on an interval and beacons a release on
`pagehide`. That lease is what drives the "in use" badge, and it is **per engine, across
users** — not per workspace, not per tab.

This app plays nothing. Taking the lease would mean a catalogue left open in a background
tab reports the engine as busy to whoever actually wants to make sound with it, and the
two apps would then fight over it every renewal interval. So the gate probes, takes the
address, and claims nothing.

That the lease is coarse enough to make this a real problem is worth writing down: it is
the first place the registry model shows its age, and it will show it again when m9
arrives.

## Why the nearest engine is taken without asking

l8 shows a picker because a musician may have several machines and cares which one
makes the sound. Reading a catalogue has no such stake: the gate takes the FASTEST engine
that answered and gets out of the way. One that answered nothing — registered, but
unreachable from this browser — is not a usable link and counts as no engine at all.

"Fastest" is measured, not assumed: the probe times its own `whoami` round trip and adds
what the engine says its audio interface costs (see `packages/web-protocol/quality.ts`).
The status bar shows the result as Q1/Q2/Q3.

If that turns out to be wrong (two machines with different libraries), the picker to add
is l8' `EngineSelect`, which is already framework-agnostic enough to lift.

## No StrictMode

`main.tsx` renders without it, matching l8. Here the reason is narrower: the probe
opens real WebSockets to every advertised address, and a double mount doubles them for
nothing.

## The gate, and whose login it goes through

**l8's backend** owns `/auth/*` for the whole origin, because l8 is what the origin root serves
and `redirectUriFor` builds `<origin>/auth/callback` with no prefix — a prefixless redirect_uri
belongs to the service that has no prefix. This backend held it while the médiathèque WAS the
root; it now passes `mountRoutes: []` like m9 and k7 always have, and the ownership has followed
the root both times it moved.

Nothing changes in *this* component: it still calls `/auth/me` and `/auth/login` same-origin,
exactly as before. What changed is who answers, and the consequence to know is the one l8's
AGENTS.md already stated in the other direction — **signing out here signs you out of every
studio service**, and pl8 being down takes every service's login with it, not just its own.
