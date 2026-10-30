# A moment names a recording, not a session

A moment (a `Comments` row, `../src/store/moments.ts`) is a span of a **recording**: any capture
of the médiathèque's zone, `recordings/<day>/<file>`. A rehearsal session is one way a capture gets
there, and the zone takes others: a machine pushing over the API, a batch dropped in by hand
(`../../mediatek/docs/recordings.md`). Every one of them is worth cutting a moment from, so the
row holds the capture's PATH (`RecordingPath`) and nothing about a session.

## A session's moments are its recording's

A session shows the moments cut from the recording it saved: the store matches the session's
`RecordingPath` against the moments', for the session's owner. Nothing on the moment points back.
When the session's page or the library asks which session a moment belongs to, the answer is
derived the same way (`sessionId` on a moment, and on `GET /moments/recording`), and is null for a
capture no session of that account saved. A capture a session saved opens as that session, so its
markers and its resume stay at hand.

A save that files the session's recording under a NEW path (an appended take re-muxed into WebM,
`audio.md`) moves that session's moments to it in the same step. Otherwise they would stay on a
path the save has just deleted.

## A capture is everyone's, a moment is its owner's

The zone is one folder that every account shares, but moments stay per account, as everything in
this store does ([ownership.md](ownership.md)). Two people can cut moments from the same capture,
and each sees only their own. The path is checked as a capture's before anything is stored: a
`recordings/<day>/<file>` that is not a moment's own clip. Nothing else is a recording, and a path
reaching out of the zone is never fetched.

## Its start, kept on the row

`RecordedAt` is when the recording started: the session's `CreatedAt` for a session's, the
`<HH-MM-SS>` of the capture's name otherwise (`../../mediatek/src/recordingName.ts`). It is what
places a moment in time (when it was PLAYED, its start plus its offset) and what names its clip.
It is stored rather than read from the recording each time, because a moment outlives its
recording and still has to sit at the right place on the calendar once the recording is gone.

## Gone is told by the listing

`recordingAvailable` is true while the recording is still there: a session of the owner holds the
path, or the zone's listing names it. The library is asked once per listing. If it cannot answer,
every moment reads as available: offering a recording that turns out to be gone costs one failed
open, while hiding one that is there loses the way to it.

## The older rows are linked once, at boot

A row from before `RecordingPath` names a session (`SessionUid`), or for a shared moment a
session's date (`SessionCreatedAt`). `linkMomentsToRecordings` (`../src/store/captures.ts`) runs
after the PocketBase import, which brings such rows too. It copies the session's path and start
onto each one and empties both old fields, so it finds nothing to do on the next boot. A row whose
session is already deleted gets no path. That row reads as a moment whose recording is gone, which
is what it is.
