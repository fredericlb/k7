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

## A take exists nowhere but the tab until it is saved

The recorder keeps its chunks in memory and uploads the whole take in one request when it stops, so
every failure mode of that request is a way to lose a performance. Three rules keep one:

- **A failed upload leaves the take in hand.** The stopped take is kept until it is saved, and the
  error comes with **Retry** — the same take, sent again — and **Download**, which saves it to the
  device under the recorder's own MIME type. Nothing about a refused upload discards the audio.
- **Once the upload has answered, the save cannot fail.** `App.tsx`'s `onSave` throws only for the
  upload itself; the annotations, the seam marker and the list refresh after it are best-effort. The
  reason is Retry: a save that failed AFTER the take was stored would offer to send it again, and an
  appended take sent twice is a session with the same audio in it twice.
- **Leaving asks first.** While a take is recording, paused, uploading or refused, closing or
  reloading the tab raises the browser's confirmation.

- **A crash leaves the take behind.** Every one-second chunk is ALSO written to IndexedDB as it is
  recorded (`apps/k7/packages/recorder/src/takeBackup.ts`), and a take's backup is deleted only once its save
  succeeds. The next visit lists what a closed or crashed tab left, with **Download** and
  **Discard**. It is best-effort: a full quota or a browser without IndexedDB means no backup, never
  a broken take. Download is the way back rather than an upload, because re-uploading would need an
  envelope the backup does not hold.
- **A source that dies is said, and the take pauses.** An input that ends mid-take — a microphone
  unplugged, a remote device gone, a chain that failed — shows why and pauses the recorder, keeping
  what came before instead of recording silence. A remote or chain failure after the connection was
  made reaches the recorder as an `ended` on the stream's tracks, the one event it listens for.
- **The envelope keeps time in a hidden tab.** Samples are owed by RECORDED time: a backgrounded tab
  that runs the sampler once a second fills the missing slots, so the waveform and the detected
  moments stay aligned with the audio.

The server gives a single request 30 minutes (`server.requestTimeout`) rather than Node's 5: an
hours-long take over a phone's uplink needs it. The take arrives on DISK (`diskUpload`), is pushed to
the médiathèque as a file-backed Blob and moved into the cache, so no copy of it is ever whole in
the backend's memory; two saves to one session run one after the other (`lock.ts`).
