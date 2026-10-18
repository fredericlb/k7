// store.ts — the desktop and Android builds desktop.yml publishes, kept on disk per channel for /app_downloads.
// A build is named by its release stamp: `vX.Y.Z` is the `release` channel, `snapshot-<commit>` the `snapshot` one.
// Files arrive in <channel>/incoming/<stamp>/; publish moves the folder into place and points `current` at it.
// The build before stays too, so an update that read latest.yml just before a publish still finds its installer.
// Layout and API: docs/app-downloads.md at the root.

import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const CHANNELS = ["release", "snapshot"] as const;
export type Channel = (typeof CHANNELS)[number];

// The two shapes desktop.yml's `decide` lets through, and nothing else.
const RELEASE_RE = /^v\d+\.\d+\.\d+$/;
const SNAPSHOT_RE = /^snapshot-[0-9a-f]{7,40}$/;
// No spaces, slashes or leading dot: a name is a path segment and a URL segment as is.
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
// An upload left in incoming/ this long is a cancelled run's, never one still arriving.
const STALE_INCOMING_MS = 6 * 3600_000;

/** The channel a stamp publishes to, or null for anything that is not a CI stamp. */
export function channelOf(stamp: string): Channel | null {
  if (RELEASE_RE.test(stamp)) return "release";
  return SNAPSHOT_RE.test(stamp) ? "snapshot" : null;
}

export const isChannel = (c: string): c is Channel =>
  (CHANNELS as readonly string[]).includes(c);
export const isFileName = (n: string): boolean => FILE_RE.test(n);

export class TooLargeError extends Error {}

export interface ReleaseFile {
  name: string;
  bytes: number;
}

export interface Release {
  channel: Channel;
  stamp: string;
  publishedAt: string;
  files: ReleaseFile[];
}

export interface AppReleaseStore {
  saveFile(
    stamp: string,
    name: string,
    source: Readable,
    maxBytes: number,
  ): Promise<ReleaseFile>;
  publish(stamp: string): Release;
  current(channel: Channel): Release | null;
  filePath(channel: Channel, name: string): string | null;
}

/** The store under `root`, which it creates as it needs to. */
export function appReleaseStore(root: string): AppReleaseStore {
  const dirOf = (channel: Channel) => path.join(root, channel);
  const incomingOf = (channel: Channel) =>
    path.join(dirOf(channel), "incoming");

  function readPointer(
    channel: Channel,
    name: "current" | "previous",
  ): string | null {
    try {
      const s = fs.readFileSync(path.join(dirOf(channel), name), "utf8").trim();
      return channelOf(s) === channel ? s : null;
    } catch {
      return null;
    }
  }

  // Write then rename, so a reader sees the old pointer or the new one, never half of one.
  function writePointer(
    channel: Channel,
    name: "current" | "previous",
    stamp: string,
  ): void {
    const target = path.join(dirOf(channel), name);
    fs.writeFileSync(`${target}.tmp`, stamp);
    fs.renameSync(`${target}.tmp`, target);
  }

  function checked(stamp: string): Channel {
    const channel = channelOf(stamp);
    if (!channel) throw new Error(`invalid stamp: ${stamp}`);
    return channel;
  }

  async function saveFile(
    stamp: string,
    name: string,
    source: Readable,
    maxBytes: number,
  ): Promise<ReleaseFile> {
    const channel = checked(stamp);
    if (!isFileName(name)) throw new Error(`invalid file name: ${name}`);
    const dir = path.join(incomingOf(channel), stamp);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    const tmp = `${target}.part`;

    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes)
          return done(new TooLargeError(`file exceeds ${maxBytes} bytes`));
        done(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, fs.createWriteStream(tmp));
      fs.renameSync(tmp, target);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return { name, bytes };
  }

  function publish(stamp: string): Release {
    const channel = checked(stamp);
    const from = path.join(incomingOf(channel), stamp);
    if (!fs.existsSync(from) || !fs.readdirSync(from).length)
      throw Object.assign(new Error(`nothing uploaded for ${stamp}`), {
        code: "ENOENT",
      });
    const dir = dirOf(channel);
    const before = readPointer(channel, "current");
    const to = path.join(dir, stamp);
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
    writePointer(channel, "current", stamp);
    if (before && before !== stamp) writePointer(channel, "previous", before);

    const keep = new Set(["incoming", stamp, readPointer(channel, "previous")]);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !keep.has(entry.name))
        fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    // Snapshot stamps do not sort, so a cancelled run's leftovers are told by their age.
    const now = Date.now();
    for (const name of fs.readdirSync(incomingOf(channel))) {
      const p = path.join(incomingOf(channel), name);
      if (now - fs.statSync(p).mtimeMs > STALE_INCOMING_MS)
        fs.rmSync(p, { recursive: true, force: true });
    }
    // biome-ignore lint/style/noNonNullAssertion: the folder was just moved into place.
    return current(channel)!;
  }

  function current(channel: Channel): Release | null {
    const stamp = readPointer(channel, "current");
    if (!stamp) return null;
    const dir = path.join(dirOf(channel), stamp);
    try {
      const files = fs
        .readdirSync(dir)
        .filter(isFileName)
        .sort()
        .map((name) => ({
          name,
          bytes: fs.statSync(path.join(dir, name)).size,
        }));
      const publishedAt = fs
        .statSync(path.join(dirOf(channel), "current"))
        .mtime.toISOString();
      return { channel, stamp, publishedAt, files };
    } catch {
      return null;
    }
  }

  function filePath(channel: Channel, name: string): string | null {
    if (!isFileName(name)) return null;
    for (const which of ["current", "previous"] as const) {
      const stamp = readPointer(channel, which);
      if (!stamp) continue;
      const file = path.join(dirOf(channel), stamp, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
    return null;
  }

  return { saveFile, publish, current, filePath };
}
