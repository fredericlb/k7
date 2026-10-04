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

Only when a project is NEW in its session — the first open, or a switch (`startEngineForActive`).
Not on the editor's own second `POST /open`, not on a save, not on a reconnect: those resend a
document the engine already holds warm, and a dry run on each would make every edit a stall.

## The dry run

Once the engine says it holds the session (`list-sessions` answers on the engine's message thread,
after the document it was queued behind), the project is sent again with `masterVolume` at -100 dB
— exactly zero on the engine's master gain, applied in place with no rebuild — played for half a
second, stopped, rewound, and kept silent a moment longer so a reverb's tail is not heard. Then the
session's latest document goes out at its own level. A document that arrives meanwhile is held,
since it would un-silence the master mid-run; the restore sends the latest one anyway.

What it does not silence: a track routed to a CUE output leaves the master before its gain
(`engine/st0-engine/docs/cueOutput.md`), so half a second of it can be heard.

## When it ends without one

The gate never waits for nothing. A failed copy ends the load (the editor's fatal dialog takes
over), a document that does not compile ends it (the editor shows the error), no engine at all ends
it, and an engine that does not report the project within two minutes ends it with a line in the
log. Another project opened meanwhile takes the load over; the old dry run sees that and stops.
