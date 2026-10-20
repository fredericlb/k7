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

**No engine bound is not ready.** While the session serves a project and the service drives no
engine, `engineLoadOf` answers `copying`, not null: the project is on no engine. The page's own
socket says nothing about it — the browser dials the engine it probed, while the service is bound
only once the page's CLAIM lands at the hub (`packages/file-hub/binding.ts`), and between two pages
of one account that claim lapses. Answered null there, Play is offered, reaches the engine, and the
project the binding then sends arrives behind it. The next engine bound is a load whatever its
address, since the one it replaces was dropped with every socket.

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
the record panel opening on every surface, a take, a picture lane's camera opened in the browser —
and the stop of a record roll switches record off, so the press that armed the person's own Play is
gone. The dry run turns it off before it plays and back on after the stop, which is the one thing
it changes of the session besides the master. It turns it off WHATEVER the link read: the link
knows record from the engine's state frames, twenty a second, and a press younger than the last one
is on at the engine while the link still says off. It puts back only what the link read, so such a
press is lost rather than rolled; the editor's Record therefore cannot be turned on while the gate
holds Play, which is when the dry run runs.

**Record does not outlive the project.** It is the engine SESSION's, not the project's, and one
session plays every project of an account in turn; the arms it rolls with are the old project's
tracks and go with the flush. Kept across a switch, the next song opens with record lit and nothing
armed, and its Play is refused. So every flush of a project (`flushProject` in `engineSessions.ts`)
switches record off with it, and notes it off on the link at once: the dry run puts back what it
read there, and a state frame sent before the switch must not be what it reads. A press made in the
NEW project before its dry run is still put back.

What it does not silence: a track routed to a CUE output leaves the master before its gain
(`engine/k7-runtime/docs/cueOutput.md`), so half a second of it can be heard.

## When it ends without one

The gate never waits for nothing. A failed copy ends the load (the editor's fatal dialog takes
over), a document that does not compile ends it (the editor shows the error), unloading the session
ends it, and an engine that does not report the project within two minutes ends it with a line in the
log. Another project opened meanwhile takes the load over; the old dry run sees that and stops.

**A dry run that is replaced stops AT ONCE, before the next project goes out.** `beginLoad` and
`endLoad` cut the load they replace short synchronously, and its stop is sent there and then — ahead
of the flush and the document of the switch that called them. Waited out instead, the half second
and the tail land in the middle of the next load: the engine is flushed while the silenced copy
plays, the old stop halts the new dry run, and a burst of opens (an e2e run opens ~180 projects in
two minutes) leaves the engine flushed under a playing transport over and over — the state after
which it stopped answering. A replaced dry run restores nothing either: the newer load's own
document carries the master at its level. An ENDED one still restores, since nothing else will.

**A load belongs to the ENGINE it is waiting on, not just to the session.** The account's engine can
change while the gate waits — a page on another device claims another machine, and the claim moves
back and forth — and a dry run still asking the engine it started on would ask a closed link until
the two-minute deadline, with the project long since applied on the engine that took over. So the
first document to reach the session through a DIFFERENT link takes the load over, and a dry run
whose link is no longer the session's stops at once: it goes back to waiting for the new engine's
document, which the next `/workspace` poll provokes by redialling, or, when no engine is selected
at all, to the wait for one above.
