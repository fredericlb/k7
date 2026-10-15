// place.ts — the last step of every write into the library: a finished temporary renamed onto
// its real name. On Windows that rename is refused while another process holds the name open
// (the engine decoding a master, a scanner reading what just landed), so a refusal is retried,
// then accepted when the file already there holds the same bytes. See docs/rename.md.

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/** The codes a held name answers with on Windows; anything else is thrown as it came. */
const HELD = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Waits between attempts, in ms: about a second in all, which a scanner lets go well inside. */
const WAITS = [20, 50, 120, 300, 500];

/** A rename that stayed refused, onto a name that holds DIFFERENT bytes; `cause` is the errno. */
export class FileHeldError extends Error {
  constructor(dest: string, cause: NodeJS.ErrnoException) {
    super(
      `${dest}: something on this machine holds this file open (the engine playing it, or a scanner); stop the playback and try again`,
      { cause },
    );
    this.name = "FileHeldError";
  }
}

const isHeld = (e: unknown): e is NodeJS.ErrnoException =>
  HELD.has((e as NodeJS.ErrnoException)?.code ?? "");

const sleep = (ms: number): Promise<void> =>
  new Promise((ok) => setTimeout(ok, ms));

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

async function digest(path: string): Promise<string> {
  const h = createHash("sha1");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

function digestSync(path: string): string {
  const h = createHash("sha1");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n = readSync(fd, buf); n > 0; n = readSync(fd, buf))
      h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/** Same bytes in both files? Size first, then the contents; unreadable answers false. */
async function sameBytes(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    if (sa.size !== sb.size) return false;
    const [ha, hb] = await Promise.all([digest(a), digest(b)]);
    return ha === hb;
  } catch {
    return false;
  }
}

function sameBytesSync(a: string, b: string): boolean {
  try {
    if (statSync(a).size !== statSync(b).size) return false;
    return digestSync(a) === digestSync(b);
  } catch {
    return false;
  }
}

/** Move `tmp` onto `dest`; on failure `tmp` is left for the caller to remove. */
export async function placeFile(tmp: string, dest: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest);
      return;
    } catch (e) {
      if (!isHeld(e)) throw e;
      if (i < WAITS.length) {
        await sleep(WAITS[i]);
        continue;
      }
      if (!(await sameBytes(tmp, dest))) throw new FileHeldError(dest, e);
      await rm(tmp, { force: true });
      return;
    }
  }
}

/** `placeFile` for synchronous callers: the waits block, and only when the name is held. */
export function placeFileSync(tmp: string, dest: string): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, dest);
      return;
    } catch (e) {
      if (!isHeld(e)) throw e;
      if (i < WAITS.length) {
        sleepSync(WAITS[i]);
        continue;
      }
      if (!sameBytesSync(tmp, dest)) throw new FileHeldError(dest, e);
      rmSync(tmp, { force: true });
      return;
    }
  }
}
