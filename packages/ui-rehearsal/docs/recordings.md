# Recordings — one page per recording, the list in the médiathèque

There is no sessions list here. The takes are listed with every other capture of the médiathèque,
in its **Recordings** section (`packages/ui-library/docs/recordings.md`). The host names that
screen as `recordingsHref`, and `/rehearsal/sessions`, `/rehearsal/moments` and the bare prefix
land on it. A take is a capture like the others once it is saved, and two lists of the same files
would teach two ways to look for last Tuesday. A moment's own page stays here, at
`/rehearsal/moments/:id`.

## One page per recording, by its path

Every recording opens at `/rehearsal/recording?path=…` (`src/containers/RecordingDetailContainer.tsx`):
its waveform, the detection, the selection, the moments and the markers. The path is a query and
not a segment of the address because it holds slashes. A saved take lands there, and so does a
moment's **Open in the recording**.

What the page offers depends on who saved the recording:

| the recording | the page | what it adds |
|---|---|---|
| a take of one of your sessions | the session's (`SessionDetailContainer`) | **Continue**, **Delete recording**, the waveform and gain the recorder measured |
| any other capture | the same view over the capture | nothing a session holds |

A capture has no **Continue**: appending re-muxes the file into a new one, which is the session's
to do to its own take. A shared folder's capture belongs to no one in particular. It has no delete
here either: it is deleted from the médiathèque, by an admin. Markers are on both, since a pin names
the recording as a moment does (`packages/rehearsal-server/docs/moments.md`).
`/rehearsal/sessions/:id` still opens a session's page, for an older link and for a session whose
take never uploaded.

A capture's gain is the one the recorder would have stored: 0.9 over the loudest bucket the
médiathèque measured, capped as the recorder caps it. A quiet take then plays as loud as a session
of the same take would.

If the médiathèque cannot measure the capture (no ffmpeg, or the analysis busy), the page still
opens. It shows why, a retry, and the audio in a plain player. A recording that cannot be listened
to because its waveform is missing would hide a file that is there.

Back returns where the page was opened from, the médiathèque as often as here. With no history to
return to, it goes to the recordings.

## Moments are found in the browser

A session's page detects its moments itself, with `@studio/recorder`'s `detectEvents` over the
envelope it fetches anyway to draw the waveform; the server has no detector and stores no detected
span. The floor and the silence length are sliders, and each move re-runs the detection: in the
browser that is arithmetic over an array already in memory, where a server round trip per move
needed a debounce and still lagged. Over the stored envelope means the whole timeline, an appended
take included, never the segment just uploaded.

**It runs when asked for.** A page opens on the recording alone, with no threshold line, no
highlighted spans and no "detected" rows: **Detect moments**, in the transport row, turns it on,
and the sliders and the detected rows come with it. Pressed again, it hides them. A recording is
opened as often to listen or to mark one passage by hand as to sift it, and twenty suggestions
nobody asked for bury the moments already saved. The choice is not kept: each page opens without it.

## A moment is consolidated on a server

On a server, a moment saved is consolidated at once and **Validate** only retries a cut that
failed. On a local instance (a desktop, a phone) no clip is cut there
(`packages/rehearsal-server/docs/momentShare.md`): each moment, on its row and on its page, offers
**Consolidate on a server…** instead, which opens a dialog (`src/components/ConsolidateDialog.tsx`).
Whether the instance is one or the other is asked of its backend once per page; a backend that does
not answer it, a server browsed from the tray, consolidates itself.

- **The dropdown lists the account's links, labelled `host · account`**, the main one first then
  in link order, each said online or offline from the backend's short ping. Asked again on each
  opening: which servers answer is what changes between two.
- **The first ONLINE server is preselected, not the main one** (`src/consolidation.ts`). The person
  opened the dialog to send something now, and a main server that is away cannot take it. A server
  the moment is already consolidated on, or one that is offline, cannot be chosen.
- **Nothing to send is said, not hidden.** With no link the dialog explains that consolidating needs
  a server; with none online, or the moment already on every server, it says so and Send stays off.
- **The send is a row of the transfer manager** (`moment:<id>:<link>`,
  `packages/http-client/docs/downloads.md`), and the moment's row says where it is going while it
  runs, then the server's own sentence if it failed. A whole recording can take minutes to go up,
  and the page may be left meanwhile.
- **Where it went is drawn as a link**, "consolidated on host · account", to the moment's page on
  that server. A recording deleted on a local instance takes the audio of its unconsolidated moments
  with it, since they have no clip of their own.

## A take exists nowhere but the tab until it is saved

The recorder keeps its chunks in memory and uploads the whole take in one request when it stops, so
every failure mode of that request is a way to lose a performance. The recorder's own safeguards —
the IndexedDB backup, a source that ends, a hidden tab — are its page
(`packages/recorder/docs/recorder.md`). The host adds three:

- **A failed upload leaves the take in hand.** The stopped take is kept until it is saved, and the
  error comes with **Retry** — the same take, sent again — and **Download**, which saves it to the
  device under the recorder's own MIME type. Nothing about a refused upload discards the audio.
- **Once the upload has answered, the save cannot fail.** `RehearsalRecording`'s save throws only
  for the upload itself; the annotations, the seam marker and the list refresh after it are
  best-effort. The reason is Retry: a save that failed AFTER the take was stored would offer to
  send it again, and an appended take sent twice is a session with the same audio in it twice.
- **Leaving asks first.** While a take is recording, paused, uploading or refused, closing or
  reloading the tab raises the browser's confirmation. Moving between k7's home pages is not
  leaving: the take is held above their routes ([audio.md](audio.md)).

The server gives a single request 30 minutes rather than Node's 5, and never holds a take whole in
memory (`packages/rehearsal-server/docs/audit.md`).

## Every upload says how far it is

A take, a release and a release's version are each one request carrying a file, and a long take
on a slow link is minutes of a request that `fetch` reports nothing about: a spinner that never
moves reads as a hang, and a hang is what makes a musician reload the tab. So every upload goes
through `@studio/http-client`'s `upload`, XMLHttpRequest's `upload.onprogress` being the one browser
API that says how many bytes have left (`packages/http-client/docs/httpClient.md`). It answers a `Response`, so `api.ts` reads it like any fetch and keeps
`ApiError`'s sentence. `uploadLabel.ts` turns the share into what the button or the line says:
a percentage, then **Analyzing…** once every byte is sent and the server is decoding and measuring
the file. The media library uploads its songs through the same helper (`packages/ui-library/docs/api.md`).

## The pop-in and the chain panel keep the keyboard inside

The recorder's pop-in and the chain panel are modal, and are not the shared `Dialog` primitive:
the pop-in becomes the bottom bar by a class swap rather than unmounting
([audio.md](audio.md)), and the chain panel is hidden rather than unmounted during a take, since
its frame is k7's open bench. A primitive that mounts its content in a portal on open would
re-parent both. `src/hooks/useFocusTrap.ts` gives them what the primitive would: focus moves in
when they show, Tab cycles inside, and focus returns where it was when they hide. Clicking outside
the pop-in hides it to the bar; nothing about the trap ends a take.

## Playing a session re-renders the playhead, not the page

A session's page follows playback every frame, so the position is a store
(`createLiveValue`, `packages/recorder`) rather than the page's state: the waveform and the
`0:42 / 3:10` clock subscribe to it (`src/components/Playhead.tsx`), the clock only when the
second changes. The page itself — the moments, their editors, the threshold controls — renders on
what the user does, never on the frame clock.
