// sidecar.ts — the `{file}.cache` file itself: its JSON shape, and reading one back. Written by
// hand rather than through JSON.stringify because the fixed precision is what bounds the size of
// arrays thousands of floats long, and because engine/st0-engine writes the same bytes. A sidecar
// whose version is older than MIN_CACHE_VERSION is refused, or it reads as fresh for ever.
// See docs/analysis.md.

import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { DEFAULT_TRANSIENT_SENSITIVITY } from "./envelope.ts";

/** `kick.wav` -> `kick.wav.cache`, kept beside the audio so it travels with the file. */
export const CACHE_EXT = ".cache";
export const cachePath = (source: string): string => source + CACHE_EXT;

/** v2 added `transients` + `sensitivity`, v3 `bpm`, v4 the three bands. */
export const CACHE_VERSION = 4;
const MIN_CACHE_VERSION = 4;

interface CacheFile {
  v?: number;
  fingerprint?: string;
  sampleRate?: number;
  channels?: number;
  frames?: number;
  seconds?: number;
  peak?: number[];
  rms?: number[];
  transients?: number[];
  sensitivity?: number;
  bpm?: number;
  low?: number[];
  mid?: number[];
  high?: number[];
}

const fixed = (xs: number[], places: number): string =>
  xs.map((v) => v.toFixed(places)).join(",");

/** The sidecar's bytes, in engine/st0-engine's field order so the two writers stay diffable. */
export function serialiseSidecar(env: FileEnvelope): string {
  return (
    `{"v":${CACHE_VERSION},"fingerprint":"${env.fingerprint}"` +
    `,"sampleRate":${Math.round(env.sampleRate)}` +
    `,"channels":${env.channels}` +
    `,"frames":${env.frames}` +
    `,"seconds":${env.seconds.toFixed(6)}` +
    `,"peak":[${fixed(env.peak, 4)}]` +
    `,"rms":[${fixed(env.rms, 4)}]` +
    `,"low":[${fixed(env.low ?? [], 4)}]` +
    `,"mid":[${fixed(env.mid ?? [], 4)}]` +
    `,"high":[${fixed(env.high ?? [], 4)}]` +
    `,"bpm":${env.bpm.toFixed(2)}` +
    `,"sensitivity":${env.sensitivity.toFixed(4)}` +
    `,"transients":[${fixed(env.transients, 6)}]}`
  );
}

export function writeSidecar(source: string, env: FileEnvelope): void {
  writeFileSync(cachePath(source), serialiseSidecar(env), "utf8");
}

/** Whatever is on disk beside `source`, or null for missing, unreadable, malformed or too old. */
export function readSidecar(source: string): FileEnvelope | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(source), "utf8")) as CacheFile;
    if (
      (c.v ?? 1) >= MIN_CACHE_VERSION &&
      typeof c.fingerprint === "string" &&
      Array.isArray(c.peak) &&
      Array.isArray(c.rms)
    )
      return {
        fingerprint: c.fingerprint,
        sampleRate: c.sampleRate ?? 48000,
        channels: c.channels ?? 1,
        frames: c.frames ?? 0,
        seconds: c.seconds ?? 0,
        peak: c.peak,
        rms: c.rms,
        transients: c.transients ?? [],
        sensitivity: c.sensitivity ?? DEFAULT_TRANSIENT_SENSITIVITY,
        // 0 is "no tempo found", and it stays 0 rather than becoming a guess.
        bpm: c.bpm ?? 0,
        // Absent rather than empty when the writer omitted them, since [] would read as silence.
        ...(c.low ? { low: c.low } : {}),
        ...(c.mid ? { mid: c.mid } : {}),
        ...(c.high ? { high: c.high } : {}),
      };
  } catch {
    /* missing / unreadable / malformed — treat as no cache */
  }
  return null;
}

/** How both writers open a sidecar — this one and engine/st0-engine's Waveform.cpp. */
const HEAD = /^\{"v":(\d+),"fingerprint":"/;

/** `readSidecar(source) !== null`, without parsing arrays thousands of floats long — docs/analysis.md. */
export function sidecarPresent(source: string): boolean {
  let fd: number;
  try {
    fd = openSync(cachePath(source), "r");
  } catch {
    return false;
  }
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(64, size));
    readSync(fd, head, 0, head.length, 0);
    const m = HEAD.exec(head.toString("latin1"));
    // Not the writers' own shape — a hand-edited file, say: the full parse decides.
    if (!m) return readSidecar(source) !== null;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    // A truncated write ends mid-array; only a whole one ends on its closing brace.
    return Number(m[1]) >= MIN_CACHE_VERSION && last[0] === 0x7d;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/** The sensitivity a sidecar was last built with, read even when its fingerprint has gone STALE. */
export function storedSensitivity(source: string): number | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(source), "utf8")) as CacheFile;
    return typeof c.sensitivity === "number" ? c.sensitivity : null;
  } catch {
    return null;
  }
}
