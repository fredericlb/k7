# Where the médiathèque makes sound

"Play this" has more than one possible answer — this browser, the host that serves the files, or
the engine on the musician's own machine — and which one is a CHOICE, not something the app picks
for you in silence: an icon button in the header, left of the cog, holding a menu of destinations.

## Why a menu and not a switch

Destinations arrive one at a time and none of them replaces another. A boolean would have to be
*replaced* the day a fourth lands — streaming the engine's output back to this browser is already
half-built (`@studio/engine-browser/stream`, unused here) — where a list entry does not.

So `frontend/src/playback/targets.ts` is a list, and everything else reads it:

| what | reads |
|---|---|
| the menu rows | `PLAYBACK_TARGETS` — label, hint, icon, `needsEngine` |
| the button's glyph | `playbackTargetInfo(target).icon` |
| what a stored id means | `asPlaybackTarget(value)` |
| what will ACTUALLY play | `effectiveTarget(chosen, engineAvailable)` |

Adding a destination is an entry in that list plus a branch in whatever plays. It is deliberately
**not** a backend change: the preference is stored as a plain string (see `prefsSchema` in
`backend/src/server.ts`), because a `z.enum` would make the vocabulary something two deployments
have to agree on before either can move. The price is `asPlaybackTarget`: an id this build has
never heard of — written by a newer one, in another tab — reads as the default rather than as a
destination nothing can play.

## Left of the cog, not inside it

The cog holds what you set once: signing out. Where sound comes out is changed *while listening*
— you hear it in the wrong room and reach for it — so it is one click, not two, and its icon
answers the question without opening anything.

## One destination can be half-there, and only one

The browser has the bytes from this origin, and the library host IS this origin; neither can be
unreachable, so neither is ever repaired. The **moteur** can be: it is a machine somebody turns
off. `needsEngine` is that one bit, `effectiveTarget` is the whole repair, and the fallback is the
browser — the destination that needs nothing.

The row is still **listed** when no engine answers, with the hint saying so rather than the label:
the choice is remembered either way, and a row that vanishes leaves "why can I not play on my
machine" with no answer on screen. The trigger's glyph shows what will actually play, greyed, so a
shut menu does not claim the moteur is doing it.

`mpv` missing on the library host is the one remaining half-state, and it is answered where it
happens — a 503 with the sentence, on the one route that needs it.

## The first: this browser

An `<audio>` element on the bytes this origin already serves. It is also mounted, silent, for the
**engine** destination, because it is what reports the DURATION: the engine's frames carry a
playhead and no length, and a scrub bar with no end is not one.

## The second: the library's own speakers

`library` plays through `mpv` on the host that serves the files, on its own outputs — for a box
wired to an amp. The why and the host-side detail are in
[packages/mpv-player/docs/mpvPlayer.md](../../../packages/mpv-player/docs/mpvPlayer.md).

It needs **no resolution** browser-side: `NowPlaying.path` is already relative to the médiathèque,
so it goes as it is and the host resolves it against its own root — which is also the guard, a
client being able to name only what that root holds.

What it does need is a **poll**. A process over there cannot push its position into this bar, so
`PlaybackProvider` asks twice a second while something is loaded, and the transport verbs are
optimistic: the handle follows the finger and the next poll tells the truth.

## The third: the moteur

`engine` plays through `engine/st0-engine` on the machine the account chose — the same instrument
st0 drives, on its own audio interface. It is the destination for somebody sitting at their rig:
the sound comes out of the monitors, not out of a laptop speaker.

### Looking costs no socket; playing holds one

`useSongEngine(connected)` does two separate things, and the split is the point. It **looks**
always — `engines.find()` on `relook`'s fifteen seconds — because the menu has to say whether the
moteur is offerable before anybody has chosen it. It **connects** only while the moteur is the
chosen destination: a catalogue tab left open on the browser destination must not hold a lease and
a session on somebody's machine for nothing.

The measured engine is kept in a REF and the socket effect keys on its **id**, so re-measuring
every fifteen seconds does not tear the link down and build it again on the same machine.

It claims the engine with **no project** (`engines.hold(found, { project: null })`), and that is
deliberate: pl8 never opens one, so it must not compete for one. Claiming here would take a song
away from the st0 tab next door. See
[packages/engine-registry/docs/claim.md](../../../packages/engine-registry/docs/claim.md).

The session is `sessionFor(SESSIONS.pl8, currentUser())` — per service AND per person. Per service
so the médiathèque cannot tear down the song st0 has open on the same machine; per person because
the médiathèque is hosted and two people can choose one machine.

### The rest of it is one page down

What the moteur actually plays — two disks and the trap between them, the preview document, the
session, the reset an apply's diff makes necessary, and how the end of a track is inferred — is
[playback.md](playback.md). It is one page because it is one subject, and every screen that starts
a song would otherwise carry a copy of it.

## What the choice does not cover

**Samples and recordings.** They have no play button, here or anywhere. When they get one, this is
the setting it reads. So the destination governs exactly one thing: a song's audio, master or
variant.

## The preference, and the trap under it

It lives on the account, in the per-user JSON (`packages/user-prefs/docs/store.md`).

That store **replaces wholesale** — a merge would make a field impossible to clear — which means
two settings that each PUT their own field erase each other. `frontend/src/prefs.ts` is the answer:
one holder for the whole document, `patchPrefs` for a change, and nothing else calls `savePrefs`.
The destination and `engineId` sit side by side in it, which is exactly the pair that would
destroy each other under a bare `savePrefs`.

`RegistryClient` in `@studio/engine-browser` is generic in that shape (`P`), defaulted to
`{engineId?}`. The schema belongs to the host, and a union of every service's fields would be a
shape no service actually has: pl8 remembers where playback happens, st0 does not.
