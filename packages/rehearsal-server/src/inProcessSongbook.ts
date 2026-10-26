// inProcessSongbook.ts — the library's songbook client, answered in this process: what a test mocks
// `mediatek.songbook()` with, over a temporary $STUDIO_MEDIATEK, so the store is tested against the
// real folder rules without a server. Test support only — the code itself always goes over HTTP.

import type { remoteSongbook } from "@studio/mediatek/remote";
import * as book from "@studio/mediatek/songbook";

type Client = ReturnType<typeof remoteSongbook>;

/** A refusal for "no such song" is the client's null; any other one is thrown as the client would. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (
      e instanceof book.SongbookRefusedError &&
      e.message.startsWith("no song")
    )
      return null;
    throw e;
  }
}

const bytesOf = async (b: Uint8Array | Blob): Promise<Uint8Array> =>
  b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b;

export function inProcessSongbook(): Client {
  return {
    list: () => book.listSongbook(),
    get: (id) => book.readSongbook(id),
    create: async (opts) => book.readSongbookAt(book.createSongbook(opts).path),
    patch: (id, patch) => orNull(() => book.patchSongbook(id, patch)),
    addSheet: async (id, bytes, sheet) =>
      orNull(async () =>
        book.addSongbookSheet(id, { bytes: await bytesOf(bytes), ...sheet }),
      ),
    removeSheet: (id, sheet) =>
      orNull(() => book.removeSongbookSheet(id, sheet)),
    setMaster: async (id, bytes, filename) =>
      orNull(async () =>
        book.setSongbookMaster(id, { filename, bytes: await bytesOf(bytes) }),
      ),
    move: (id, to) => orNull(() => book.moveSongbook(id, to)),
    detach: (id) => orNull(() => book.detachSongbook(id)),
    remove: async (id) => {
      await orNull(() => book.deleteSongbook(id));
    },
  };
}
