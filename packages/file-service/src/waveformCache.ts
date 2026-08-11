// waveformCache.ts — the Node side of the on-disk waveform cache the ENGINE computes:
// tell whether a `{source}.cache` sidecar is still valid (same fingerprint), spawn the
// engine to rebuild a stale one, read the envelope back. Clip-region slicing and the
// tempo grid stay in @studio/commands/waveform. Full rationale: docs/waveformCache.md.

import { execFile, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { promisify } from "node:util";
import type { FileEnvelope } from "@studio/commands/waveform";

const execFileAsync = promisify(execFile);

// `kick.wav` -> `kick.wav.cache`, kept beside the audio so it travels with the file.
export const CACHE_EXT = ".cache";
export const cachePath = (source: string): string => source + CACHE_EXT;

// --- content fingerprint (MUST byte-for-byte match engine/engine/Waveform.cpp) -----
// FNV-1a/64 over the file size + up to HEAD/TAIL bytes from each end — see docs/waveformCache.md.
const HEAD = 65536;
const TAIL = 65536;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

export function fileFingerprint(source: string): string {
  const size = statSync(source).size;
  let h = FNV_OFFSET;
  const step = (byte: number): void => {
    h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  };
  // Size as 8 little-endian bytes.
  let s = size;
  for (let k = 0; k < 8; k++) {
    step(s & 0xff);
    s = Math.floor(s / 256);
  }
  const fd = openSync(source, "r");
  try {
    const buf = Buffer.allocUnsafe(Math.min(HEAD, Math.max(0, size)) || 1);
    // Head: [0, min(size, HEAD)).
    const headLen = Math.min(HEAD, size);
    if (headLen > 0) {
      const n = readSync(fd, buf, 0, headLen, 0);
      for (let i = 0; i < n; i++) step(buf[i]);
    }
    // Tail: [max(0, size - TAIL), size).
    const tailStart = size > TAIL ? size - TAIL : 0;
    const tailLen = size - tailStart;
    if (tailLen > 0) {
      const tbuf = tailLen <= buf.length ? buf : Buffer.allocUnsafe(tailLen);
      const n = readSync(fd, tbuf, 0, tailLen, tailStart);
      for (let i = 0; i < n; i++) step(tbuf[i]);
    }
  } finally {
    closeSync(fd);
  }
  return `${size}-${h.toString(16).padStart(16, "0")}`;
}

// --- sidecar read + (re)generation -------------------------------------------------

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

/** The default transient threshold — mirrors `kDefaultTransientSensitivity` in EngineHost.h. */
export const DEFAULT_TRANSIENT_SENSITIVITY = 2;

/**
 * The oldest sidecar shape still usable. v2 added `transients` + `sensitivity`, v3 added `bpm`, v4 added the
 * three band envelopes a coloured waveform is drawn from.
 *
 * Gating on this is load-bearing, not tidiness: an older sidecar carries a MATCHING fingerprint — the audio has
 * not changed — so every freshness check would pass and the file would never get whatever the bump added.
 * Raise it with every field added on the engine side, or the field silently never arrives.
 */
const MIN_CACHE_VERSION = 4;

function readSidecar(source: string): FileEnvelope | null {
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
        // 0 is the engine's "no tempo found", and it stays 0 rather than becoming a guess.
        bpm: c.bpm ?? 0,
        // Absent rather than empty when the engine did not write them: a surface reads "not
        // analysed that way" and draws a plain envelope, where [] would read as silence.
        ...(c.low ? { low: c.low } : {}),
        ...(c.mid ? { mid: c.mid } : {}),
        ...(c.high ? { high: c.high } : {}),
      };
  } catch {
    /* missing / unreadable / malformed — treat as no cache */
  }
  return null;
}

/**
 * The sensitivity a source's sidecar was last built with, or null when there is no readable one.
 *
 * Read even from a sidecar whose fingerprint has gone STALE, which is the whole point: rebuilding the envelope of
 * a re-recorded take must not silently reset a threshold somebody tuned for it.
 */
export function storedSensitivity(source: string): number | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(source), "utf8")) as CacheFile;
    return typeof c.sensitivity === "number" ? c.sensitivity : null;
  } catch {
    return null;
  }
}

// So a burst for one source doesn't re-read the sidecar: mtime is the cheap gate, the fingerprint stays the truth.
interface Memo {
  mtimeMs: number;
  env: FileEnvelope;
}
const memo = new Map<string, Memo>();

/**
 * A fresh envelope: the memo, a matching sidecar, else the engine decodes it. Throws with no binary — no JS decoder.
 *
 * `sensitivity` asks for the transient threshold. Omitted, whatever the sidecar already carries is kept — that is
 * what makes the setting per-source and sticky. Given and different, the envelope is rebuilt: the onsets live in
 * the same file as the peaks, so changing one means writing both.
 */
export async function ensureFileEnvelope(
  source: string,
  engineBin: string | null,
  sensitivity?: number,
): Promise<FileEnvelope> {
  const mtimeMs = statSync(source).mtimeMs; // throws ENOENT for a missing source
  const wanted = sensitivity ?? storedSensitivity(source);
  const usable = (e: FileEnvelope): boolean =>
    sensitivity === undefined || e.sensitivity === sensitivity;

  const hit = memo.get(source);
  if (hit && hit.mtimeMs === mtimeMs && usable(hit.env)) return hit.env;

  const fp = fileFingerprint(source);
  const cached = readSidecar(source);
  if (cached && cached.fingerprint === fp && usable(cached)) {
    memo.set(source, { mtimeMs, env: cached });
    return cached;
  }

  if (!engineBin)
    throw new Error(
      "engine binary not found — cannot compute the waveform cache",
    );
  // The engine writes `{source}.cache` itself; we just read it back.
  await execFileAsync(
    engineBin,
    wanted == null
      ? ["--waveform", source]
      : ["--waveform", source, String(wanted)],
    { maxBuffer: 1 << 20 },
  );
  const fresh = readSidecar(source);
  if (!fresh) throw new Error("engine did not produce a waveform cache");
  memo.set(source, { mtimeMs, env: fresh });
  return fresh;
}

// Drop the memo for one source (or all) when it changed underneath us, so the next request re-checks the sidecar.
export function invalidateEnvelope(source?: string): void {
  if (source) {
    memo.delete(source);
    freshMemo.delete(source);
  } else {
    memo.clear();
    freshMemo.clear();
  }
}

// --- batch (re)generation ----------------------------------------------------------

/** Size+mtime of a source and of its sidecar — the pair a "still fresh" verdict was made about. */
function pairStamp(source: string): string | null {
  try {
    const a = statSync(source);
    const b = statSync(cachePath(source));
    return `${a.size}:${a.mtimeMs}|${b.size}:${b.mtimeMs}`;
  } catch {
    return null; // no sidecar (or no source) — nothing to trust
  }
}

/**
 * Sources judged fresh, against the stamp of the two files that were compared. Only YES is
 * remembered: a stale one is about to be rebuilt anyway, and remembering NO would need clearing.
 *
 * The check itself reads the whole sidecar and 128 kB of the audio to hash it, so a project of
 * 110 takes spent ~190 ms answering "nothing to do" — and l8's browser asks on every command,
 * on the same single process that is compiling the answer to that command. The fingerprint is
 * still what DECIDES; this only skips asking again about two files neither of which has moved,
 * which is the gate `ensureFileEnvelope`'s memo right below already stands on.
 */
const freshMemo = new Map<string, string>();

// Is `source`'s sidecar present and still matching the file's current content?
function cacheFresh(source: string): boolean {
  const stamp = pairStamp(source);
  if (stamp && freshMemo.get(source) === stamp) return true;
  const c = readSidecar(source);
  const ok = !!c && c.fingerprint === fileFingerprint(source);
  if (ok && stamp) freshMemo.set(source, stamp);
  else freshMemo.delete(source);
  return ok;
}

// The distinct sources whose sidecar is missing or stale — the work a prewarm actually needs; a missing file drops.
export function staleWaveformSources(sources: string[]): string[] {
  const out: string[] = [];
  for (const s of new Set(sources)) {
    try {
      statSync(s); // skip a source that no longer exists
      if (!cacheFresh(s)) out.push(s);
    } catch {
      /* missing / unreadable — skip; the on-demand path surfaces it */
    }
  }
  return out;
}

// Compute every stale sidecar in ONE process, paying startup once; `onResult` fires per file for a live count.
export function runWaveformBatch(
  engineBin: string,
  sources: string[],
  onResult?: (source: string, ok: boolean) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(engineBin, ["--waveform-batch"], {
      stdio: ["pipe", "pipe", "inherit"], // stderr → our log; stdout is the progress stream
    });
    // Aborting kills the child so it releases the .wav mid-decode — Windows can't rename a folder it holds open.
    const onAbort = () => child.kill();
    if (signal) {
      if (signal.aborted) child.kill();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        const ok = line.slice(0, tab) === "ok";
        const src = line.slice(tab + 1);
        invalidateEnvelope(src); // re-read the freshly-written sidecar next time
        onResult?.(src, ok);
      }
    });
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", () => {
      cleanup();
      resolve();
    });
    child.stdin.on("error", () => {}); // a dead child racing our write — surfaced via close/error
    // `<path>` or `<path>\t<sensitivity>`: a file whose previous sidecar carried a tuned threshold is rebuilt
    // with it, so a prewarm never quietly resets one. The default is left to the engine.
    child.stdin.write(
      sources
        .map((s) => {
          const sens = storedSensitivity(s);
          return sens == null || sens === DEFAULT_TRANSIENT_SENSITIVITY
            ? s
            : `${s}\t${sens}`;
        })
        .join("\n") + "\n",
    );
    child.stdin.end();
  });
}
