# Every FLAC gets an MP3 beside it

`src/media/mp3Sweep.ts` walks the whole library — songs, samples and the capture zone — and writes
a same-named MP3 beside every FLAC that has none, or whose MP3 is older than the FLAC. It runs in
the background at boot and every five minutes, like the waveform sweep ([analysis.md](analysis.md)).

## Who plays it, and who does not

The MP3 is what **browsers** play: `/stream` serves it for a FLAC ([streaming.md](streaming.md)),
and that route is what the rehearsal server caches from, what the médiathèque's player loads and
what k7's playlist pane loads. FLAC playback in a browser is inconsistent, and an MP3 is a third of
the size.

**The engine and a machine's mirror keep the FLAC.** They read `/file` and the manifest, and the
mirror holds the master byte for byte. The library hides the MP3 from its manifest, its listings
and its change tokens, so no machine ever fetches it and no tree ever draws it —
`packages/mediatek/docs/derivedMp3.md` is the rule.

## Beside the FLAC, not in a cache

Next to its FLAC, the MP3 moves and is deleted with it (the library's write helpers carry it), and
whoever looks at the folder on the volume sees both. A copy under `.cache/` would need a second
tree kept in step with the first by hand. A volume's `.cache/stream/`, where no code reads, is
removed when the sweep starts.

## Made ahead, and on demand as a fallback

The sweep exists so `/stream` finds the MP3 ready. A FLAC uploaded a second ago has not been swept
yet, so `/stream` makes the MP3 itself (`ensureMp3` in `src/media/transcode.ts`), and a transcode
in flight is shared by both: the sweep and a request for the same FLAC never run ffmpeg twice.

"Older than its FLAC" counts as missing: a replaced master must not keep playing the old take. A
half-written MP3 is a dot-file (`.original.mp3.<uuid>.part`) until it is renamed, so no walk ever
counts it. A FLAC replaced while ffmpeg read it discards the result, and one removed or moved
during the run takes the fresh MP3 with it, so an MP3 never outlives the FLAC that made it. The
sweep does not count either as a failure; `/stream` asks once more.

## How it stops

One file at a time, with a 250 ms gap, so ffmpeg never takes the whole machine. Every transcode —
the sweep's and `/stream`'s — also passes one gate in `src/media/transcode.ts`: two at once and
eight waiting, past which `/stream` answers 503 rather than start one more ffmpeg, and the sweep
leaves the FLAC for its next pass. A listener flipping through FLACs nobody has swept would
otherwise start a process per click. ffmpeg runs with `-protocol_whitelist file,pipe`, so a crafted
file cannot make it open a URL. A FLAC that fails
is not retried in this process. No ffmpeg stops the sweep for good and says so once in the log.
`GET /api/mediatek/mp3` reports what it is on, what is left and what failed.

## Off on the user's own machine

`STUDIO_MP3_SWEEP=0` turns the sweep off, and the tray and the phone set it in their table
([../standalone.md](../standalone.md)). Their page runs in a current browser or Android's WebView, which play
a FLAC as it is, the engine shares that machine's CPU, and the phone has no ffmpeg at all.
`/stream` still makes an MP3 on demand there when ffmpeg is on the `PATH`.
