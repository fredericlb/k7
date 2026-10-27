# The rehearsal recorder

The rehearsal recorder is the part of k7 for playing rather than producing: you press record at
the start of a rehearsal and let it run, then go back to the moments worth keeping. It also holds
the band's shared songbook, your published releases and their public pages, and a few practice
tools. It opens at `/rehearsal`.

If your instance answers on a `k7.` address, any page there sends you to the same page under
`/rehearsal`.

## The sections

The home sidebar's **Rehearsal** group has four entries:

| Entry | Address | What it holds |
|---|---|---|
| Recordings | `/rehearsal/sessions` | Your sessions and the moments cut out of them, by day |
| Publications | `/rehearsal/releases` | Your releases and the pages that list them |
| Songbook | `/rehearsal/songs` | The band's songs: lyrics with chords, tablature, sheets, a reference track |
| Exercises | `/rehearsal/exercices` | Singing exercises, random chords, a guitar tuner |

`/rehearsal` on its own opens Recordings.

Sessions and moments are yours alone. The songbook and the singing exercises are shared by
everyone signed in to the instance (a song can be made private). Releases and pages are yours, and
a page can be opened by others through its link.

## Recording a session

1. Click the red dot (**New session**) in the sidebar. It is there on every rehearsal page.
2. If you chose a rehearsal chain on k7's **Frozen chains** page (see below), a menu asks where the
   audio comes from:
   - **Local device**: this computer's or phone's microphone or audio interface.
   - **K7 chain**: your rehearsal chain, named under it.

   With no rehearsal chain chosen, the session records from the local device straight away.
3. Allow microphone access if the browser asks.

The recorder is a bar at the bottom of the window, and it stays there for the whole take: the page
above stays usable, so you can browse other pages, including the songbook, while it records. A
session is created at once.

Only one take runs at a time: pressing the red dot during a take says "Finish the current recording
first."

### While recording

- **The waveforms**: most of the bar shows the whole take from its start, and the small one at its
  right scrolls the last few seconds as they are played. The recorder levels them automatically;
  the recorded audio itself is not changed.
- **Highlights**: everything between silences is flagged live as a highlight, shown as a chip under
  the waveform. A silence is two seconds or more below the floor (15% of the loudest level so far);
  a highlight shorter than four seconds is ignored.
- **Listening back**: click a highlight's chip to pause the take and play that span ("Reviewing
  from – to"). A row above the bar plays it again, and you can answer "What happened here?" with
  tags. Tagged highlights become moments when the session is saved.
- **Resume** (the red dot), at the right of the bar, carries the take on after a pause or a
  highlight; **Pause** stops it for a moment without ending it.
- **Metronome**, in the ⋮ menu at the far right: type a tempo in BPM and start it. While it runs, changing the tempo changes the
  click. It plays on this device; it is not recorded.
- The screen is kept awake while recording, so a phone locking itself does not cut the take.
- Closing the tab during a take asks for confirmation.

### Stopping

**Stop & save** (the square), at the right of the bar, must be held for two seconds: no stray tap ends a long
take. The take is uploaded and analysed ("Uploading & analyzing…"), then the session's page opens.

If the upload fails, the recorder offers **Retry upload** and **Download the take**.

### Takes that were never saved

Every part of a take is also kept in the browser while it is recorded. If a tab crashes or is
closed before the take is saved, the next visit to a rehearsal page shows "N take(s) a closed or
crashed tab left unsaved": **Download** keeps one as a file, **Discard** forgets it (after a
confirmation, since it is saved nowhere else).

### Microphone problems

| Message | What to do |
|---|---|
| Microphone permission was denied | Allow the microphone in the browser's site settings |
| No microphone was found | Connect an input device, or free it from another app |
| The microphone is busy or unavailable | Another app is using it |
| Microphone access needs a secure context | Open k7 over `https://` (or `http://localhost`) |
| The input went away mid-take | The take is paused; what came before is kept |

## Recording through a chain

Sessions can record an instrument played through one of your frozen chains, as heard at the
engine's output:

1. On k7's home page, open **Frozen chains** and press the microphone button on one of your chains:
   it is marked **used for rehearsals**. Press it again to unmark it. Only a chain that can be
   recorded through live can be chosen.
2. **New session** → **K7 chain** then opens that chain on k7's bench, out of sight, with the input
   the chain names, and the take starts as soon as the chain's output reaches the recorder.
3. If the chain names no input channel, a small dialog asks which input of the interface feeds it,
   and the take starts once one is picked.

When the engine is elsewhere, the chain's output is also played on this device; when it runs on this
machine you already hear it through your interface. If the engine changes its sample rate
mid-stream, the take must be started again.

## Settings

The home **Settings** page has a **Rehearsal** section:

- **Clean up empty sessions** deletes, after a confirmation, every session that has no moments and
  was recorded more than 24 hours ago, with its recording.
- **CLI access token**: **Generate token** makes a personal token, used to publish songs from k7
  (see [Releases and pages](./76-releases-and-pages.md)). **Copy** copies it; **Regenerate** makes
  a new one. Anyone holding it can upload releases as you.

## Related pages

- [Sessions and moments](./75-sessions-and-moments.md)
- [Releases and pages](./76-releases-and-pages.md)
- [The songbook](./77-songbook.md)
- [Exercises](./78-exercises.md)
