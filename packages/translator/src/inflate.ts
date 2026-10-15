// inflate.ts — unzip and gunzip with a ceiling on what they may inflate to, since an import is a
// file a stranger may upload. fflate sizes its output from the sizes the archive DECLARES and never
// grows it, so refusing a declared size over the ceiling bounds the memory spent.

import { gunzipSync, type UnzipFileInfo, unzipSync } from "fflate";

/** The most an imported archive may inflate to, every entry together. */
export const MAX_INFLATED_BYTES = 1024 * 1024 * 1024;

/** `unzipSync`, refusing an archive whose entries declare more than `limit` bytes in all. */
export function boundedUnzip(
  bytes: Uint8Array,
  limit = MAX_INFLATED_BYTES,
): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(bytes, {
    filter: (f: UnzipFileInfo) => {
      total += f.originalSize;
      if (f.originalSize > limit || total > limit)
        throw new Error(
          `this archive inflates past ${Math.round(limit / 2 ** 20)} MiB — refused`,
        );
      return true;
    },
  });
}

/** `gunzipSync`, refusing a stream whose trailer declares more than `limit` bytes. */
export function boundedGunzip(
  bytes: Uint8Array,
  limit = MAX_INFLATED_BYTES,
): Uint8Array {
  const n = bytes.length;
  // The gzip trailer's ISIZE, which is the size fflate allocates and fills.
  const size =
    n < 4
      ? 0
      : (bytes[n - 4] |
          (bytes[n - 3] << 8) |
          (bytes[n - 2] << 16) |
          (bytes[n - 1] << 24)) >>>
        0;
  if (size > limit)
    throw new Error(
      `this file inflates past ${Math.round(limit / 2 ** 20)} MiB — refused`,
    );
  return gunzipSync(bytes);
}
