# A moment shared with the server, its session kept on the machine

On a machine paired with a server (`../../file-hub/docs/syncRelay.md`), a session never leaves the
machine it was recorded on. Nothing sends a session's row or its recording anywhere: a rehearsal is
hours of audio, most of which nobody will listen to again. A **moment** can go up, one at a time and
only when someone asks for it. A moment is the part of a take worth keeping, and it already exists
to outlive its session (`../../rehearsal-shared/types.ts`).

## What goes up, and what stays

A shared moment carries its span, its text and tags, its envelope, its markers and its CLIP: the
moment's own audio, cut out of the session as validating a moment already does. A moment that has
no clip yet is cut first, on the machine, before it is sent. The session's row, its recording and
its other moments stay on the machine.

On the server the moment has no session. It keeps its session's DATE (`SessionCreatedAt`, in
`../src/schema.ts`), because sessions have no name and the date is how a moment is labelled. It
reads like a moment whose session was deleted, which is what it is from the server's side.

## Whose moment it is

The server files the moment under the PERSON who paired the device, the OIDC subject the device
token names, so it appears in that person's moments on the server. A token from before tokens
named a person cannot share a moment, and says so: the machine has to pair again. On the server,
a moment id that belongs to someone else is refused, never overwritten. The id comes from the
machine and becomes a row id and a cache file's name, so one that is not a plain segment is
refused (400), as is a `moment` field that is not JSON ([serving.md](serving.md)).

## Sharing again replaces

The copy keeps the machine's moment id, which is how the machine tells which of its moments the
server holds (`../src/momentShare.ts`). Sharing a moment the server already holds REPLACES the
server's copy: its clip, its text and its markers. This is the one way an edit made on the machine
reaches the server. There is no live sync of moments, for the same reason as for songs
(`songbookCopy.md`).

## Read-only on the server

The copy records the machine it came from (`SharedFrom`, the name the device was paired under),
and `../src/routes/moments.ts` refuses every change to it: a marker added, edited or removed. An
edit made on the server would be lost silently at the next share, so the server takes none. The
moment's page says where to edit it instead. It can still be DELETED there: that takes nothing from
the machine, and the machine's icon simply goes back to "on this machine only".
