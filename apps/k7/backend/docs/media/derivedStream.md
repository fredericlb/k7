# Every FLAC gets an Opus copy beside it

`src/media/streamSweep.ts` walks the whole library — songs, samples and the capture zone — and
writes a same-named WebM (Opus, 128 kbit/s) beside every FLAC that has none, or whose copy is
older than the FLAC. It runs in the background at boot and every five minutes, like the waveform
sweep ([analysis.md](analysis.md)).

## Who plays it, and who does not

The copy is what **browsers** play: `/stream` serves it for a FLAC ([streaming.md](streaming.md)),
and that route is what the rehearsal server caches from, what the médiathèque's player loads and
what k7's playlist pane loads. FLAC playback in a browser is inconsistent, and the copy is a fifth
of the size.

**Opus in WebM, not MP3**, because it is encoded in WebAssembly (`@studio/audio-analysis`'s
transcode, `packages/audio-analysis/docs/transcode.md`) and no Rust MP3 encoder is good enough to
replace ffmpeg's — and WebM/Opus is what the rehearsal recorder already serves every browser, iPhones
included, so it asks nothing new of a listener.

**The engine and a machine's mirror keep the FLAC.** They read `/file` and the manifest, and the
mirror holds the master byte for byte. The library hides the copy from its manifest, its listings
and its change tokens, so no machine ever fetches it and no tree ever draws it —
`packages/mediatek/docs/derived.md` is the rule.

## Beside the FLAC, not in a cache

Next to its FLAC, the copy moves and is deleted with it (the library's write helpers carry it), and
whoever looks at the folder on the volume sees both. A copy under `.cache/` would need a second
tree kept in step with the first by hand. A volume's `.cache/stream/`, where no code reads, is
removed when the sweep starts, and so is an `.mp3` an older backend derived beside a FLAC: the
sweep deletes it as it passes, and until then the library hides it like the WebM.

## Made ahead, and on demand as a fallback

The sweep exists so `/stream` finds the copy ready. A FLAC uploaded a second ago has not been swept
yet, so `/stream` makes the copy itself (`ensureStreamCopy` in `src/media/streamCopy.ts`), and an
encode in flight is shared by both: the sweep and a request for the same FLAC never encode it twice.

"Older than its FLAC" counts as missing: a replaced master must not keep playing the old take. A
half-written copy is a dot-file (`.original.webm.<uuid>.part`) until it is renamed, so no walk ever
counts it. A FLAC replaced while it was read discards the result, and one removed or moved during
the run takes the fresh copy with it, so a copy never outlives the FLAC that made it. The sweep does
not count either as a failure; `/stream` asks once more.

## How it stops

One file at a time, with a 250 ms gap. The encode runs on a worker of `@studio/audio-analysis`'s
pool, never on the thread that answers requests, and is killed past ten minutes as stuck. Every
encode — the sweep's and `/stream`'s — also passes one gate in `src/media/streamCopy.ts`: two at
once and eight waiting, past which `/stream` answers 503 rather than queue one more, and the sweep
leaves the FLAC for its next pass. A listener flipping through FLACs nobody has swept would
otherwise queue an encode per click. A FLAC that fails is not retried in this process.
`GET /api/mediatek/stream-copies` reports what it is on, what is left and what failed.

## Off on the user's own machine

`STUDIO_STREAM_SWEEP=0` turns the sweep off, and the desktop app and the phone set it in their table
([../standalone.md](../standalone.md)). Their window is Chromium or Android's WebView, which play
a FLAC as it is, and the engine shares that machine's CPU. `/stream` still makes a copy on demand
there.
