// copyTree.ts — a folder copied with several files in flight, what `fs.cp` does one file at a time.
// A real copy, never a link: the hub writes inside a version it installed (docs/fileHub.md, "The libraries are the hub's").

import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Files copied at once; past this the disk, not the loop, is what waits. */
const IN_FLIGHT = 8;

/** Copy `from` into `to` (created), skipping every path `keep` refuses, and the whole folder under a refused one. */
export async function copyTree(
  from: string,
  to: string,
  keep: (src: string) => boolean = () => true,
): Promise<void> {
  const files: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    await mkdir(join(to, rel), { recursive: true });
    for (const e of await readdir(join(from, rel), { withFileTypes: true })) {
      const child = rel ? join(rel, e.name) : e.name;
      if (!keep(join(from, child))) continue;
      if (e.isDirectory()) await visit(child);
      else files.push(child);
    }
  };
  await visit("");
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const rel = files[next++];
      // A copy-on-write clone where the disk offers one (APFS, btrfs), a plain copy elsewhere.
      await copyFile(
        join(from, rel),
        join(to, rel),
        constants.COPYFILE_FICLONE,
      );
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
}
