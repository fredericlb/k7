// lcdSounds.ts — the sound files a module's screens draw (`lcd.sound(slot)`), fetched from the file
// service and decoded HERE as a WAV, mono, at the file's own length: the browser's decodeAudioData
// resamples to its context's rate, and a 2048-sample wavetable frame would stop being 2048 samples.
// A library ref is tried in `wavetables/`, then `samples/` — what the compile tries (song's faustFiles.md).

import type { LcdSounds } from "@studio/ui-chains/lcdScreen";
import { mediaUrl } from "./api";

/** A PCM or float WAV, its channels averaged; null for anything else. */
export function decodeWav(buf: ArrayBuffer): Float32Array | null {
  const v = new DataView(buf);
  if (v.byteLength < 12 || v.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
  let fmt: { tag: number; ch: number; bits: number } | null = null;
  for (let i = 12; i + 8 <= v.byteLength; ) {
    const id = v.getUint32(i, false);
    const size = v.getUint32(i + 4, true);
    const at = i + 8;
    if (id === 0x666d7420)
      // "fmt "
      fmt = {
        tag: v.getUint16(at, true),
        ch: v.getUint16(at + 2, true),
        bits: v.getUint16(at + 14, true),
      };
    if (id === 0x64617461 && fmt) {
      // "data"
      const bytes = fmt.bits / 8;
      const frames = Math.floor(
        Math.min(size, v.byteLength - at) / (bytes * fmt.ch),
      );
      const out = new Float32Array(frames);
      const read = (o: number): number =>
        fmt?.tag === 3 && fmt.bits === 32
          ? v.getFloat32(o, true)
          : fmt?.bits === 16
            ? v.getInt16(o, true) / 32768
            : fmt?.bits === 24
              ? (v.getUint8(o) |
                  (v.getUint8(o + 1) << 8) |
                  (v.getInt8(o + 2) << 16)) /
                8388608
              : fmt?.bits === 32
                ? v.getInt32(o, true) / 2147483648
                : 0;
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < fmt.ch; c++)
          sum += read(at + (f * fmt.ch + c) * bytes);
        out[f] = sum / fmt.ch;
      }
      return out;
    }
    i = at + size + (size & 1);
  }
  return null;
}

/** The workspace paths a ref may name, in the order the compile tries them. */
export function soundPaths(ref: string, project: string | null): string[] {
  const m = /^@([^/]+)\/(.+)$/.exec(ref);
  if (!m) return project ? [`${project}/${ref}`] : [];
  const [, level, rest] = m;
  const base = level === "project" ? project : `_libraries/${level}`;
  return base ? [`${base}/wavetables/${rest}`, `${base}/samples/${rest}`] : [];
}

/** One decoder for the shell: each file fetched once, its result kept, every screen told when one lands. */
export function createLcdSounds(project: () => string | null): LcdSounds {
  const cache = new Map<string, Float32Array | null>();
  const listeners = new Set<() => void>();
  const load = async (ref: string): Promise<void> => {
    for (const path of soundPaths(ref, project())) {
      try {
        const res = await fetch(mediaUrl(path));
        if (!res.ok) continue;
        const pcm = decodeWav(await res.arrayBuffer());
        if (!pcm) continue;
        cache.set(ref, pcm);
        for (const l of listeners) l();
        return;
      } catch {
        /* the next candidate, or nothing to draw */
      }
    }
  };
  return {
    get(ref) {
      if (!cache.has(ref)) {
        // Marked at once, so a screen repainting while it loads does not start a second fetch.
        cache.set(ref, null);
        void load(ref);
      }
      return cache.get(ref) ?? null;
    },
    subscribe(onLoaded) {
      listeners.add(onLoaded);
      return () => listeners.delete(onLoaded);
    },
  };
}

// The shell's ONE decoder, shared by every graph it mounts; App keeps it told which project is open.
let openProject: string | null = null;
export const setLcdSoundsProject = (p: string | null): void => {
  openProject = p;
};
export const shellSounds: LcdSounds = createLcdSounds(() => openProject);
