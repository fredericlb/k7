# The captures: a calendar, and each day's timeline

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

**Add a capture** sits under the calendar, so it never scrolls away with a long day.

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
