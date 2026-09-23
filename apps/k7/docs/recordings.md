# Recordings — sessions and their moments, one timeline

`apps/k7/frontend/src/views/RecordingsTimeline.tsx` is the whole of the **Recordings** entry: a
calendar to pick a day, and that day's sessions on a timeline with each session's moments hanging
under it, indented.

## One list, not a Sessions tab and a Moments tab

A moment is a stretch of a session, so the question a list has to answer is "what did I get out of
that take?" — two tabs made you hold the session in your head while reading the other list.
Under its session, a moment is in the order it was played (by its offset into the take), and its
time column shows the wall-clock time it happened: the session's start plus that offset.

`/moments` survives as an address and lands on `/sessions`; a moment's own page (`/moments/:id`) is
unchanged.

## Orphans stand with the sessions

A moment outlives the session it was captured in (`Moment.sessionUid` still names a session that
no longer exists). It then has nothing to hang under, so it takes the session level, placed on the
day and at the time it was made, and says "session deleted".

## The tag filter keeps sessions, not only moments

A tag narrows the list to what carries it: a session stays when **any** of its moments has the
tag, and only those moments show under it; an orphan stays when it has the tag itself. The
calendar then marks only the days with a match, and choosing a tag jumps to the newest one — a
filter that leaves you on an emptied day looks like it found nothing.
