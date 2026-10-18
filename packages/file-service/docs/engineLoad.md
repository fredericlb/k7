# engineLoad — a project is playable when the gate lets go

Three things stand between an opened project and a play that answers at once: its files copied to
the engine's machine, the engine building the song and loading its plugins, and every plugin's
first block of audio. Left behind the editor, the first play pays for all three in the worst way —
a Stop that answers late, a playhead that will not move. So the wait is in FRONT of the editor:
`ProjectGate` holds its screen (`packages/project-shell/src/EngineLoadScreen.tsx`) until the file
service reports the project ready, one phase at a time:

| phase | what runs | what the screen shows |
|---|---|---|
| `copying` | the `sync` job (`engineSync.md`) | files and megabytes, and a bar that fills |
| `applying` | the engine applying the document, plugins included | a sentence, and a bar that cannot be measured |
| `warming` | the DRY RUN | a sentence |

`engineLoad.ts` holds the phase per session; `GET /workspace` answers it as `engineLoad`.

## When a load starts

Only when a project is NEW in its session — the first open, or a switch (`startEngineForActive`) —
or NEW to its ENGINE: an engine selected after the project opened, or another one taking over, holds
nothing of it. That second case is caught by address (`sentTo` in `engineLink.ts`), and the
`/workspace` poll that would report no phase starts the load instead. Without it the gate lets go on
an empty engine, Play is answered, and the build that follows a moment later discards it.

Not on the editor's own second `POST /open`, not on a save, not on a reconnect to the same engine:
those resend a document the engine already holds warm, and a dry run on each would make every edit a
stall.

## The dry run

Once the engine says it holds the session (`list-sessions` answers on the engine's message thread,
after the document it was queued behind), the project is sent again with `masterVolume` at -100 dB
— exactly zero on the engine's master gain, applied in place with no rebuild — played for half a
second, stopped, rewound, and kept silent a moment longer so a reverb's tail is not heard. Then the
session's latest document goes out at its own level. A document that arrives meanwhile is held,
since it would un-silence the master mid-run; the restore sends the latest one anyway.

**Record is off for that half second.** Rolling a session whose record is on RECORDS: a count-in,
the record panel opening on every surface, a take. The dry run turns it off before it plays and back
on after the stop, which is the one thing it changes of the session besides the master.

What it does not silence: a track routed to a CUE output leaves the master before its gain
(`engine/k7-runtime/docs/cueOutput.md`), so half a second of it can be heard.

## When it ends without one

The gate never waits for nothing. A failed copy ends the load (the editor's fatal dialog takes
over), a document that does not compile ends it (the editor shows the error), no engine at all ends
it, and an engine that does not report the project within two minutes ends it with a line in the
log. Another project opened meanwhile takes the load over; the old dry run sees that and stops.

**A load belongs to the ENGINE it is waiting on, not just to the session.** The account's engine can
change while the gate waits — a page on another device claims another machine, and the claim moves
back and forth — and a dry run still asking the engine it started on would ask a closed link until
the two-minute deadline, with the project long since applied on the engine that took over. So the
first document to reach the session through a DIFFERENT link takes the load over, and a dry run
whose link is no longer the session's stops at once: it goes back to waiting for the new engine's
document, which the next `/workspace` poll provokes by redialling, or lets the gate go when no
engine is selected at all.
