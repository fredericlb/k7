# waveformCache.ts — extended notes

The on-disk waveform cache is computed BY THE ENGINE. The C++ side decodes an audio
file once (any format JUCE reads — wav/aiff/flac/ogg/…), downsamples it to a
placement-independent peak+RMS envelope, and writes it next to the source as
`{source}.cache` (JSON), stamped with a cheap content fingerprint.

This module is the Node side: it computes the SAME fingerprint to tell whether a
sidecar is still valid, spawns the engine to (re)build a missing/stale one, and reads
the envelope back. The clip-region slicing and the tempo grid stay in
`@studio/commands/waveform` — this only produces the `FileEnvelope` those consume.

Sidecars sit next to the audio rather than in a central store, so they travel with the
file and the engine can write one during an offline decode. They're hidden from the file
tree and gitignored.

## The content fingerprint

**MUST match `apps/moteur/engine/Waveform.cpp` byte for byte.**

A cheap, cross-language fingerprint: FNV-1a/64 over the file SIZE (8 little-endian
bytes), then up to `HEAD` bytes from the front and up to `TAIL` bytes from the end.

- It reads at most `HEAD + TAIL` bytes regardless of file length, so it stays fast on
  large audio.
- It depends only on file CONTENT (not mtime), so C++ and Node compute the identical
  value.
- For small files the head/tail ranges overlap — both sides read the same overlapping
  bytes, so the hash still agrees.

String form: `"<size>-<hex16>"`.

## Caching layers

1. **In-memory memo** — so a burst of waveform requests for the same source doesn't
   re-read the sidecar and re-fingerprint the file every time. Keyed by source path; a
   changed mtime drops the entry (the fingerprint is authoritative, but mtime is the
   cheap first gate). Cleared implicitly by process lifetime.
2. **The sidecars** — the durable cache.

`ensureFileEnvelope` takes the fast path (memo, or a sidecar whose fingerprint still
matches) and otherwise spawns the engine to decode and rewrite. It throws when the
engine binary is unavailable: this is engine-only, there is no JS decoder fallback.

`runWaveformBatch` computes every stale sidecar in ONE engine process
(`--waveform-batch`), paying JUCE's startup cost once instead of per file. `onResult`
fires per file as it finishes so a caller can drive a live progress count, and each done
source is dropped from the memo so the next read picks up the fresh sidecar.
