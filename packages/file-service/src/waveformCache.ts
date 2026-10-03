// waveformCache.ts — spawning the ENGINE to build a `{source}.cache` sidecar, and the memo in
// front of it. The sidecar's FORMAT — its fingerprint, its fields, reading one back — is
// @studio/audio-analysis's, because pl8 writes the same file with no engine at all. Clip-region
// slicing and the tempo grid stay in @studio/audio-probe/waveform. See docs/waveformCache.md.

import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import { analyseFile } from "@studio/audio-analysis/analyse";
import { DEFAULT_TRANSIENT_SENSITIVITY } from "@studio/audio-analysis/envelope";
import { fileFingerprint } from "@studio/audio-analysis/fingerprint";
import {
  CACHE_EXT,
  cachePath,
  readSidecar,
  storedSensitivity,
} from "@studio/audio-analysis/sidecar";
import type { FileEnvelope } from "@studio/audio-probe/waveform";

const execFileAsync = promisify(execFile);

// Re-exported so this module's importers keep resolving them; they are the sidecar's, not ours.
export {
  CACHE_EXT,
  cachePath,
  DEFAULT_TRANSIENT_SENSITIVITY,
  fileFingerprint,
  storedSensitivity,
};

// --- (re)generation through the engine -------------------------------------------

// So a burst for one source doesn't re-read the sidecar: mtime is the cheap gate, the fingerprint stays the truth.
interface Memo {
  mtimeMs: number;
  env: FileEnvelope;
}
const memo = new Map<string, Memo>();

/**
 * The decodes running right now, keyed by source AND the sensitivity asked for. Two asks for one
 * file are ONE decode: a timeline drawing several lanes off the same take asks for it several times
 * at once, and without this each ask spawned its own engine over the same 33 MB — see
 * docs/waveformCache.md.
 */
const inFlight = new Map<string, Promise<FileEnvelope>>();

/** A fresh envelope: the memo, a matching sidecar, else the engine decodes it — see docs/waveformCache.md. */
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

  // Joined rather than started again — the sidecar this leaves is the same one either way.
  const key = `${source}\u0000${wanted ?? ""}`;
  const running = inFlight.get(key);
  if (running) return running;

  const decode = (async (): Promise<FileEnvelope> => {
    // No engine here — the hosted service: ffmpeg writes the same sidecar, as pl8 does (docs/waveformCache.md).
    if (!engineBin) {
      const env = await analyseFile(
        source,
        wanted ?? DEFAULT_TRANSIENT_SENSITIVITY,
      );
      memo.set(source, { mtimeMs, env });
      return env;
    }
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
  })();
  inFlight.set(key, decode);
  try {
    return await decode;
  } finally {
    // Cleared here rather than in a `.finally` on the promise: a failed decode must not be joined either.
    inFlight.delete(key);
  }
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

/** Sources judged fresh, against the stamp of the two files compared; only YES is remembered. */
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
    // `<path>` or `<path>\t<sensitivity>`, so a prewarm never quietly resets a tuned threshold.
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
