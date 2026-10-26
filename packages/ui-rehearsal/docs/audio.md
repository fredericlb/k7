# Audio in the rehearsal pages

What the pages do with sound: where a take is drawn, how
a song's reference track is played, transposed and fetched. Where the bytes are stored is the
server's page (`packages/rehearsal-server/docs/audio.md`); how a take is captured is the
recorder's (`packages/recorder/docs/recorder.md`).

## Where a new take opens

The take is held by `RehearsalRecording`, which k7 wraps around its home routes
(`apps/k7/frontend/src/appMain.tsx`), so a take survives going from a rehearsal page to the media
library, the projects or the settings and back. It has no route of its own: it is drawn either in a
**pop-in** over the page, or collapsed to a bar at the bottom of the content column. It holds
nothing until a take starts — no microphone, no engine — so wrapping every home page costs them
nothing; what it draws is a lazy chunk.

Hiding the pop-in (its Hide button, Escape, a click on the backdrop) collapses it; the take keeps
running. The pop-in is two wrapper classes swapped around the recorder, not a dialog component: a
portal or a conditional wrapper would re-parent `RecorderView`, and React would remount it —
ending the take it holds.

A take starts from the red dot k7 draws as the rehearsal pages' action (`NewSessionButton`), or
from resuming a session. It opens in the pop-in, except on one song's page, where it begins
collapsed and the page stays readable: you record against a song in order to READ it while you
play, and covering the tablature the instant the tape rolls is the one thing that use has no answer
to. The bar reopens the pop-in for the controls the collapsed form cannot carry.

The pop-in and the bar stay inside the content column, never over k7's sidebar nor its home bar:
the sidebar is how you move between pages while the take runs, and the bar is what plays. Being held
above the routes, they are outside the column, so they read where it is from the host's
`--host-column-left` and `--host-column-bottom` (0 without a host).

## Drawing must not eat the audio

The waveform canvas is redrawn whenever the envelope's identity changes, hence the memoised
object: an envelope recreated on every render redraws on every playhead tick.

The **playback playhead is a DOM layer**, not a stroke on the canvas: following it at 60 fps with a
full redraw allocates enough for the garbage collector to cause an audible hiccup.

When a session is extended the waveform shows the old take **in front of** the new: the display
timeline is offset by the length of the existing envelope, so the two stretches meet edge to
edge. The recorder's own timeline — detected moments, listening, pending annotations — stays
relative to the new take.

## Two sources, one recorder

This device's microphone or a chain of k7's library played on k7's
bench ([chainSource.md](chainSource.md)). Each reaches the recorder as a `MediaStream`, so the
waveform, the moments and the upload are the same whatever the source.

## Releases and pages: one player

A release and a page draw their audio like the songbook does — the shape measured on the server,
the same one component (`WaveformPlayer`), because "a shape that seeks, and a button that stops"
is one idea and not three. The song page plays through the app's mini player instead (below): a
track you rehearse to for an hour is a transport, not a card in the page.

**Every version and every page entry gets its own player**, so a list mounts many of them. Each
one loads its audio only on the first play (`preload="none"`): a page of ten releases must not
pull ten masters before anyone presses play. The shape still loads on mount, and a spinner stands
where the shape will be, then on the button while the audio buffers. **One track plays at a
time**: starting one pauses the one before, because two masters at once is never the point.

## A songbook song's reference track

The track is a song of the media library, streamed from `/api/mediatek/stream` on k7's own
origin with the person's session, with Range; a FLAC master comes as the library's cached MP3.

### The mini player, not a player of the page's own

The track plays through `@studio/ui-mini-player`, the bar the médiathèque and k7's references
already wear (`packages/ui-mini-player/docs/miniPlayer.md`): play/pause, a scrubber with its clocks,
and the system's media session. One bar across the app means one way to stop a sound, wherever
it comes from. The **Original / Instrumental switch is in the bar's row**, the host's slot: it
chooses what plays, so it belongs with what plays.

- **The `<audio>` element is the page's**, drawn by nobody, beside the bar rather than inside the
  médiathèque's transport. The timed lyrics follow and seek it, and the transposition runs through it
  — neither could reach mpv or an engine, which the médiathèque's destinations would offer.
- **The bar is up as soon as the song has a track**, paused at the start. Its close silences the
  track and takes the bar away; the element stays mounted, so a tapped lyric line still plays, and
  playing brings the bar back. A headphones button by the title is the way back without lyrics.
- **The bar PLAYS; it does not change the file.** Linking a track is in the song's ⋮ menu, beside
  every other thing the song can be given.
- **No waveform.** The scrubber says where you are and the lyrics say what is sung there; a shape
  in the margin would be a third answer to the same question.
- **It stands at the foot of the content column**, on top of a phone's panel bar and of a minimized
  take, so recording against the song keeps its transport in reach. The page and the rail leave it
  room (`--song-bar-h`).

### The rail holds what changes what you READ

On a desktop the Options, the chord diagrams and the metronome sit in a floating rail down the
right margin, each collapsible by its own toggle. Above the tabs they would cost the page its
first screenful; in the margin they stay reachable without displacing anything.

**One rail, mounted once, holding the panels stacked.** Two independently fixed panels would
overlap the moment a song had chords and options, and deciding which one covers the other is not
a decision worth having. They share the chrome (`.rail-panel`) and nothing else. The order reads
from what you are doing: **Options** first — transposition, which changes what you READ — then the
chord diagrams, and the metronome. The metronome is a panel too, not a floating button:
one convention for "a control that hovers over the song".

**Folded, they are all 200 px wide.** A folded panel is a tab, and tabs of three different widths
down one edge read as breakage rather than as a stack. The word is clipped rather than wrapped.

**They all open folded.** The page is the song; a margin of three open drawers is not, and on a
laptop the chords panel alone takes a quarter of the width. Folding costs one click and is
remembered for as long as the page is open.

**On a narrow screen the rail lies down**: the same panels become a bar of icons at the foot of the
screen, and an opened one rises above that bar. It is the same DOM and the same state — only the
layout changes, at one breakpoint — so nothing about a panel has two implementations to keep in
step. The glyph each toggle carries becomes its label there, the word being what only the desktop
has room for.

A tapped chord still opens over the sheet as a popin. That is a different gesture from opening the
Chords panel — one asks "what is THIS chord", the other "what chords are in this song" — and they
answer in different places on purpose ([chordDiagrams.md](chordDiagrams.md)).

### Transposing moves the track, not just the sheet

The Options panel's Transpose changes the chord sheet AND what you play along to: the reference
track is pitch-shifted as it plays, in the browser, by **signalsmith-stretch** (MIT, WASM in an
AudioWorklet). The node runs in its LIVE INPUT mode, where the playback rate is ignored by
construction — so the pitch moves and the tempo cannot, which is the whole requirement. A rate
change would be the cheap way (`preservesPitch = false`) and it is precisely the wrong one: the
song would slow down as it dropped.

Real time in the browser, rather than a render per semitone on the server. ffmpeg's `rubberband`
filter would sound better, but it means a wait the first time each key is asked for, a file per
semitone for both the track and its instrumental, and an invalidation every time the track
changes — against a gesture that is meant to be a nudge of − / + while you read. The library was
picked over `soundtouchjs` on licence as much as on quality: LGPL-2.1 in a bundled frontend is a
complication, MIT is not.

**At zero no stretcher runs.** A song nobody transposes pays nothing at all: no audio context, the
element plays itself. The first semitone builds the graph, in two audio contexts:

- **The element's context holds its source for good.** A media element gives its source node once,
  so from the first semitone on the element always plays through this context — straight to the
  speakers at zero, which costs a pass-through and nothing more.
- **The stretcher has a context of its own, closed whenever the shift returns to zero**, and fed
  from the element's through a `MediaStream`. An AudioWorklet that answers "keep me alive" — this
  one does — is processed for as long as its context runs, connected or not: in the element's
  context, a song transposed once and put back at zero would run the stretcher, on silence, until
  the page closed.

The cost, while transposed: the sound trails the element's own clock by the node's latency and the
bridge between the two contexts, so a highlighted lyric line runs slightly ahead of what you hear.
It is constant and small, and the alternative — delaying the lyrics to match — would make a seek
feel late.

## Fetching a song: from the médiathèque, into the songbook

Two entries of the song's ⋮ menu, and they are two because their costs are not the same.
**"Fetch song"** finds the song in the media library, hunts it on Soulseek when it is not there
(the médiathèque files what it downloads) and links its master as the reference track. **"Make
instrumental"** takes the song already in the library and has the médiathèque run an engine's
instrumental chain over it — one file, the record without its voice.

Separating stems borrows a musician's machine for a minute or so per song and is wanted far less
often than a track to play along to, so it is asked for rather than ridden along with.

- **The hunt and the stems are asked from the page, as the user** (`src/fetchSong/pl8.ts`). The
  hunt is session-only on purpose — a service must not spend somebody's Soulseek account — so the
  search runs under the person's own session, lands in their own hunt history and counts against
  their own limit. The library answers on the same origin, so the calls carry the session cookie.
- **A link, not a copy.** A song stores the library PATH of its master, and of the
  `instrumental.wav` beside its stems; the page streams both from the médiathèque itself. The
  rehearsal server holds no bytes of either, so a song is never two files drifting apart.
- **An upload goes INTO the library**, as this song, under the album `k7`
  (`songs/<artist>/k7/<title>`): a folder of its own, so filing it never collides with — nor
  replaces — a catalogue song, and the uploaded track can be separated like any other.
- **An upload asks what to make of the track** before it leaves, from either way in — the insert or
  « Add a track… » (`UploadTrackDialog.tsx`): the lyrics off LRCLIB, OFF by default, and the
  instrumental, ON. Cancelling uploads nothing. A run resumed while stemming never goes back to the
  lyrics, so a reload keeps that answer without it being stored.
- **A track is never replaced nor removed from the songbook**: it is a song of the media library,
  and a different file for it, or none, is the library's business. The ⋮ menu offers « Add a
  track… » only to a song that has none.
- **Relinking never deletes a file.** A new link, or a dropped instrumental, only forgets the old
  path: every path a song holds is the library's.
- **The best-rated engine makes it.** Separation needs a machine running an engine that k7's backend
  can reach; k7's own image carries neither the model nor its runtime. The page names none: the server
  picks the best-rated one this account may cut on — its own, or the server's
  (`apps/k7/backend/docs/media/stems.md`). When none is online, the cut answers 409 and "Make
  instrumental" says so and changes nothing, so pressing it again once one is up is the whole retry.
- **Songs are fetched from the server the pages read** (`pl8Base`, `src/fetchSong/pl8.ts`): the hunt
  files into that server's library, the track is copied from it and the cut runs where it is. On the
  tray that is the server picker's choice (`apps/k7/frontend/docs/serverPicker.md`).
- **The library song is found by artist and title** (`src/fetchSong/match.ts`): equal once accents,
  case and punctuation are dropped, else every typed word in the entry, else the same title by an
  artist a typo away (Gonzales / González). That is how a song FINDS its track; its stems are then
  cut from the recording it links, never looked up again by name — a same-named library song (a
  live take) might be another recording.
- **What would be hunted is checked before anything downloads** (`src/fetchSong/run.ts`). The
  médiathèque names a query through MusicBrainz (Deezer when unreachable) before searching
  Soulseek, and that name can be another song: « Expedition 33 Lumières » is the band Lumières'
  « Momentary ». The page asks for the name alone (`/api/hunt/identify`), compares it with the
  song's artist and title (each a typo away at most, `sameSong` in `match.ts`), and only then hunts
  — THOSE tags, so the download is the recording that was checked. A mismatch downloads nothing and
  names what was found.
- **"Make instrumental" never hunts.** It works on the song the library already holds: a song
  missing from the library is a "Fetch song" away, and spending a Soulseek search on a button about
  stems would be a surprise.
- **The sum happens where the parts are.** The engine's chain writes `instrumental.wav` beside the
  song, having added the stems while they were still in memory, and that file is what the song
  links. It streams as WAV — twice a FLAC's size, the price of keeping no transcoded copy anywhere.
- **Which chain does it is the engine machine's answer**, set in k7's settings (*Separation
  chains*) or with `system instrumental <chain>`, exactly as `system stems` answers for the four
  parts. The page names no chain: it asks for an instrumental and the machine that can make one
  says how.
- **A song the médiathèque already holds offers no choice.** Opening a song with no track looks it
  up in the library first (`heldInLibrary`); when it is there, the page copies it and goes straight
  on to the lyrics and the instrumental, showing their progress — "Download / Upload / Ignore" is
  only for a song the library lacks, since fetching it costs nothing and nobody would answer
  otherwise. A song whose insert was ignored stays ignored, and a library out of reach leaves the
  choice as it was.
- **Every step checks what is already done**, so pressing again resumes: the médiathèque goes on
  hunting and separating if the page is closed, and a second press finds the song filed and the
  stems held.
- **A failure stays on the song** (`fetchStatus`, phase `failed`), whichever step it came from, and
  the insert under the title shows it with Retry and Dismiss — a reload shows it again. A step that
  fails after the track landed is as visible as one before. LRCLIB out of reach and no engine
  online are reported the same way, without stopping the chain: one does not keep the other from
  running.
- **Lyrics come before stems** (search → download → lyrics → stems), because LRCLIB also says
  when a recording has **no lyrics at all**. A song LRCLIB lists as instrumental is marked
  « instrumental »: it gets no stems, since there is no voice to take out and separating one costs a
  musician's machine a minute for nothing, and the ⋮ menu offers no "Make instrumental". Nothing
  under the title says so: a song with nothing to sing needs no notice about it. LRCLIB is
  crowdsourced, so a song it has no record of still gets its stems.
- **The lyrics step only TIMES the lyrics** ([lyricsTiming.md](lyricsTiming.md)). Lyrics already
  timed are left alone.
- **"Run the pipeline again"**, in the ⋮ menu, first UNLINKS the song's library track and its
  instrumental (the library keeps both files), then runs every step from the search: asked for
  again, the pipeline must be free to find another recording than the one an earlier run linked.
  Lyrics are searched again whenever they are not timed. A fresh start never resumes a stored hunt
  or separation id: the one stored may be the one that failed, and resuming it would fail again.
- **Retry**, under the title after a failure, keeps the track and redoes only what is not done.
- **"Resync lyrics"**, in the ⋮ menu, is the lyrics step alone and on timed lyrics too: it takes
  every code off, then times the lyrics off LRCLIB again. The re-run skips lyrics that are already
  timed, because codes typed or fixed by hand must not be overwritten by an unasked search.
  An unmatched resync leaves the lyrics without codes, which is what was asked.
- **Status writes go out one after the other** (`SongDetailContainer.tsx`): two concurrent PATCHes
  can land in either order and leave a stale phase stored, which a reload would then try to resume.

A new or removed track drops the instrumental with it: an instrumental of the previous track would
play under the wrong song. The player offers Original / Instrumental on one element, keeping the
position, so timed lyrics follow whichever plays.
