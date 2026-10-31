# The captures: a calendar, and each day's timeline, the takes included

`src/RecordingsCalendar.tsx` is the whole of the **Recordings** section: a calendar to pick a day, and
that day's captures on a timeline, each with the account's moments indented under it. The rows are
built in `src/recordingCalendar.ts`, which is pure and tested on its own.

## The same screen the sessions have

A capture is a time and some bytes (`packages/mediatek/docs/recordings.md`). What a person looks for
is "the one from Tuesday evening", which a calendar answers and a list of folder names does not.
The rehearsal sessions answer the same question with the same screen
(`packages/ui-rehearsal/docs/recordings.md`): a calendar on the left marking the days with
something on them, tag chips under it, and the day's timeline beside it. Two screens for one
question would teach two ways to look for a recording. The zone therefore has no tree. Nothing in
a day folder is a folder, and the tree only restated the day before the time.

It is also where a rehearsal take is listed once saved: the rehearsal pages have no sessions list
(`packages/ui-rehearsal/docs/recordings.md`). Under the calendar, the host's **Record**
(`recordButton`) starts a take, and **Add recordings** files existing ones. Both sit there so that
they never scroll away with a long day.

## Your takes, durations, and who deletes what

A capture one of your sessions recorded wears a microphone. Every row shows how long it runs: a take
from its session, any other capture from the médiathèque's own measure of it
(`src/captureSeconds.ts`). Measuring decodes the whole file the first time, so only the shown day's
captures are asked for, one at a time. The médiathèque keeps its measure, and the tab remembers the
answer. A row shows its size until its duration comes, and keeps it when the file cannot be measured.

A take is yours to delete from the row's ⋮. Any other capture, someone else's take included, is
deleted only by whoever may remove from the shared library (an admin, or the machine's own user on a
desktop), as every removal in the médiathèque is (`apps/k7/backend/docs/media/gate.md`). Both go
through the rehearsal store (`DELETE /api/moments/recording`), never the library's own file route.
The store removes the file and every session that saved it, with their markers, so no session is
left pointing at a file that is gone (`packages/rehearsal-server/docs/moments.md`). The moments cut
from it stay, each with its own clip. The confirmation says so, since that is the part a person
deleting a recording would not expect.

## Shared moments, on a paired machine

On a machine paired with a server, each moment says whether the MAIN server holds a copy of it, as the
moment's own page does (`packages/rehearsal-server/docs/momentShare.md`): a cloud with a check for
one it holds, a drive for one only here. Anywhere else, or when the server is away, nothing is drawn,
since no icon is better than a wrong one.

## A capture's time is its name

Each row shows the time the capture STARTED, read off its `<HH-MM-SS>` name
(`packages/mediatek/src/recordingName.ts`), in the local time the zone filed it under. A file's mtime
is when its last byte was written, which for an hour-long take is an hour off, so it serves only
for a file the zone did not name. A moment's row shows the wall-clock time it was played: the
capture's start plus its offset.

## Moments, never their clips

A moment's clip is a file in the same day folder, and the zone does not list it
(`listRecordings`). The moment shows under the capture it was cut from, which says what the clip
is. Listed beside the capture, the clip would read as a second, shorter recording of the same
evening. A day holding only clips is not marked.

The moments come from the rehearsal store, the signed-in account's alone
(`packages/rehearsal-server/docs/moments.md`), so two people looking at the same zone each see the
same captures and only their own moments. A backend without that store shows the captures alone.
A moment whose capture is no longer listed is not drawn here, since there is nothing to hang it
under: the rehearsal timeline still lists it.

## A row opens on the host's page

A capture opens on the page that cuts moments from it, and a moment on its own page. Both pages
are the rehearsal package's, so the host names where they are (`recordingHref`, `momentHref`,
[host.md](host.md)). This package does not import the rehearsal screens, and a host without them
leaves the rows inert rather than linking to an address that does not exist.

The tag filter keeps a capture when one of its moments carries the tag, and shows only those
moments, as the sessions' does. Choosing a tag lands on its newest day.
