// lcdSounds.ts — the sound files a module's screens draw (`lcd.sound(slot)`), fetched from the file
// service and decoded HERE as a WAV, mono, at the file's own length: the browser's decodeAudioData
// resamples to its context's rate, and a 2048-sample wavetable frame would stop being 2048 samples.
// A library ref is tried in `wavetables/`, then `samples/` — what the compile tries (song's faustFiles.md).

import type { LcdSounds } from "@studio/ui-chains/lcdScreen";
import { mediaUrl } from "./api";
import { onLeave } from "./scopeLeave";

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

/** How long a sound found nowhere waits before it is looked for again. */
const RETRY_MS = 30_000;

/** One decoder for the shell: each file fetched once, its result kept, every screen told when one lands. */
function createLcdSounds(
  project: () => string | null,
): LcdSounds & { clear: () => void } {
  // Keyed by project AND ref: a ref resolves against the open project, so another one's same name is another sound.
  const cache = new Map<string, Float32Array | null>();
  const listeners = new Set<() => void>();
  const load = async (key: string, ref: string, at: string | null) => {
    for (const path of soundPaths(ref, at)) {
      try {
        const res = await fetch(mediaUrl(path));
        if (!res.ok) continue;
        const pcm = decodeWav(await res.arrayBuffer());
        if (!pcm) continue;
        if (!cache.has(key)) return; // cleared while it loaded: another project now
        cache.set(key, pcm);
        for (const l of listeners) l();
        return;
      } catch {
        /* the next candidate, or nothing to draw */
      }
    }
    // Found nowhere: asked again later rather than blank for the session — the file may not exist YET.
    setTimeout(() => {
      if (cache.get(key) === null) cache.delete(key);
    }, RETRY_MS);
  };
  return {
    get(ref) {
      const at = project();
      const key = `${at ?? ""}\n${ref}`;
      if (!cache.has(key)) {
        // Marked at once, so a screen repainting while it loads does not start a second fetch.
        cache.set(key, null);
        void load(key, ref, at);
      }
      return cache.get(key) ?? null;
    },
    // Emptied, and every screen told: what it draws is asked for again, so a re-rendered sample shows.
    clear: () => {
      if (!cache.size) return;
      cache.clear();
      for (const l of listeners) l();
    },
    subscribe(onLoaded) {
      listeners.add(onLoaded);
      return () => listeners.delete(onLoaded);
    },
  };
}

// The shell's ONE decoder, shared by every graph it mounts; App keeps it told which project is open.
let openProject: string | null = null;
const shared = createLcdSounds(() => openProject);
export const setLcdSoundsProject = (p: string | null): void => {
  // Another project's sounds are not drawn here again: let their PCM go.
  if (p !== openProject) shared.clear();
  openProject = p;
};
export const shellSounds: LcdSounds = shared;

/** A write that may have changed a sound the screens draw — a sample, a wavetable, or nobody said which. */
export const touchesSounds = (files: { path: string }[] | null): boolean =>
  files === null ||
  files.some((f) => /(^|\/)(samples|wavetables)\//.test(f.path));

/** Forget the decoded sounds after such a write; the screens ask again for what they draw. */
export const refreshLcdSounds = (): void => shared.clear();

// Forgotten with the project: the next one names its own.
onLeave(() => {
  openProject = null;
  shared.clear();
});
