// testWav.ts — the smallest file TagLib accepts as audio, for the tests that tag a master:
// a RIFF/WAVE header and a few frames of 16-bit silence. Built in memory, no fixture on disk.

/** A valid mono 8 kHz WAV of `frames` silent samples. */
export function tinyWav(frames = 64): Buffer {
  const data = frames * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); // byte rate
  b.writeUInt16LE(2, 32); // block align
  b.writeUInt16LE(16, 34); // bits per sample
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  return b;
}
