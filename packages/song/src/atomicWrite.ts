// atomicWrite.ts — replace a file whole or not at all: write a hidden temp beside it, fsync, rename over.
// The temp's name starts with a dot, so every workspace `skip` (capture, watchers, listings) already hides it.
// Why here, and why the Windows retry: docs/atomicWrite.md.

import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const TEMP_NAME = /^\..+\.\d+\.[0-9a-f]{8}\.tmp$/;
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRIES = 8;

/** Is `name` (a bare file name) one of the temps writeFileAtomic leaves behind if it dies mid-write. */
export const isAtomicTemp = (name: string): boolean => TEMP_NAME.test(name);

/** The temp a write of `file` goes through: hidden, in the same folder, unique to this process and call. */
export function atomicTempFor(file: string): string {
  const rand = Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, "0");
  return join(dirname(file), `.${basename(file)}.${process.pid}.${rand}.tmp`);
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename, retrying the transient refusals a Windows scanner or indexer holding `to` gives. */
function renameRetrying(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (
        process.platform !== "win32" ||
        !RETRY_CODES.has(code) ||
        i >= RETRIES
      )
        throw e;
      pause(10 * 2 ** i);
    }
  }
}

function modeOf(file: string): number | undefined {
  try {
    return statSync(file).mode & 0o7777;
  } catch {
    return undefined;
  }
}

/** Writes `data` to `file` so a reader sees the old bytes or the new ones, never a part; keeps the file's mode. */
export function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  opts: { mode?: number } = {},
): void {
  const tmp = atomicTempFor(file);
  const kept = modeOf(file);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, "w", kept ?? opts.mode ?? 0o666);
    // The umask applies to a new file's mode, not to the one an existing file already had.
    if (kept !== undefined && process.platform !== "win32")
      fchmodSync(fd, kept);
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let off = 0;
    while (off < bytes.length)
      off += writeSync(fd, bytes, off, bytes.length - off);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameRetrying(tmp, file);
  } catch (e) {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      // never created, or already gone
    }
    throw e;
  }
}
