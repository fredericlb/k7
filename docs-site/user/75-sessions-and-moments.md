# Sessions and moments

A **session** is one recording: everything captured between pressing the red dot and holding
**Stop & save**. A **moment** is a span of a session you chose to keep, with a name, tags, and its
own clip. To record, see [The rehearsal recorder](./74-rehearsal-recorder.md).

## The Recordings page

`/rehearsal/sessions` shows one day at a time:

- **A calendar**: days holding a session or a moment are marked. Click a day to show it. It opens
  on the newest day with something to show.
- **Tag filters**: one chip per tag used on your moments. Click one to show only the moments
  carrying it; the page jumps to the newest day that has a match.
- **The day's timeline**: each session with its time, and its moments indented under it. A moment
  whose session was deleted stands on its own, marked "session deleted".

Click a session or a moment to open it. The bin on a session row deletes it after a
confirmation. Deleting a session keeps its moments.

## A session's page

`/rehearsal/sessions/<id>` shows the whole recording.

### Listening

The waveform is the session, levelled for display. Click to move the playhead; **Play** and
**Pause** drive it. A link with `?t=<seconds>` opens the session at that point.

### Finding the moments worth keeping

Two settings drive the automatic detection, and the detected highlights are drawn on the
waveform as you change them:

| Setting | Range | Effect |
|---|---|---|
| **Silence floor (min volume)** | 0 to the peak, shown in % of peak | Below this level counts as silence |
| **Min silence gap** | 0.5 to 10 s | How long a silence must last to separate two highlights |

If nothing is detected, lower the floor to pick up quieter playing.

To keep a span:

- Drag across the waveform to select it ("Selected from – to"), then **Save as moment**; or
- Click **Save moment** on a detected highlight.

**Clear** drops the selection. A saved moment can then be named (**Name…**) and tagged.

### Moments on the session page

Each moment in the **Moments** list can be:

- Played, renamed and tagged (remove a tag with its **x**).
- **Adjust range**: drag the handles on the waveform, or nudge the **Start** and **End**, then
  **Apply & re-extract**.
- **Validate**: extract a standalone clip of that span. The clip is filed in the media library's
  **Recordings** section, in the session's day folder, as
  `moment-<time>--<seconds>--<name>`.
- Deleted.

### Markers

**Add marker** drops a marker at the playhead; type a comment beside it. Click a marker to jump
there; each can be edited or deleted. When a session is continued, a marker "resumed on <date>"
is added where the new take begins.

### Continue recording

**Continue recording** records more audio onto the end of the session. The new take's highlights
and tags are placed on the whole session's timeline.

### Deleting

**Delete session** removes the session and its recording, after a confirmation. Its moments stay.

## A moment's page

`/rehearsal/moments/<id>` shows a moment's clip:

- "Captured <date>", its length, and its tags.
- The clip's waveform and a play button ("No clip has been extracted for this moment yet." until it
  is validated).
- Its own **Markers**, as on a session.
- **Open in session at <time>** goes to the session with the playhead at the moment's start.
- **Delete moment** removes it and its clip.

## Where the audio is kept

A session's audio and every extracted clip are files in the media library's Recordings section,
filed by day. The rehearsal pages keep only what describes them: durations, waveforms, moments,
tags and markers. See [Songs and samples](./71-songs-and-samples.md#recordings).

## On a desktop or phone paired with a server

Sessions stay on the machine that recorded them. A moment can be shared with the server:

- Its row shows "Shared with <server>" or "On this machine only".
- **Share with the server** sends the clip, its span, its name, tags and markers (not the
  session). **Share again** replaces the server's copy with this one.

On the server, a shared moment is read-only: "Shared from <device>: it is edited there and shared
again."
