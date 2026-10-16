// mediatekPrefetch.ts — the songs the open projects name, put onto the bound ENGINE'S machine
// ahead of time: a set list's twelve songs are on its disk before the gig, where the venue may
// have no network. Asked over the jobs path; the tunnel moves what is missing or changed, and a
// list that did not move is not asked again. See docs/mediatekPrefetch.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { JobError, requestJobAt } from "@studio/engine-tunnel/jobs-client";
import { mediatekSongRefs } from "@studio/song/mediatekRefs";
import { mediatekRoot } from "@studio/song/mediatekRoot";
import { songPathPrefix } from "@studio/song-schema/songRef";
import { liveWorkspaces } from "./workspaces.ts";

/** How often the open projects are asked what they name; each ask that finds a change costs one request. */
const EVERY_MS = 60_000;
/** The first ask, delayed so a cold start is not competing with the binding it needs. */
const FIRST_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** What the last prefetch that WORKED sent, and where — the same list to the same machine is not sent twice. */
let settled = "";
let lastError = "";

/** Every file under the song folders the open projects name, absolute on this server, sorted. */
export function namedSongFiles(): string[] {
  const root = mediatekRoot();
  const folders = new Set<string>();
  for (const ws of liveWorkspaces()) {
    const dir = ws.activeProjectPath();
    if (!dir) continue;
    for (const ref of mediatekSongRefs(dir, ws.root))
      folders.add(songPathPrefix(ref));
  }
  const files: string[] = [];
  for (const folder of folders) {
    const abs = join(root, ...folder.split("/").filter(Boolean));
    try {
      for (const e of readdirSync(abs, {
        recursive: true,
        withFileTypes: true,
      }))
        if (e.isFile()) files.push(join(e.parentPath, e.name));
    } catch {
      /* a song the volume no longer has — nothing to bring */
    }
  }
  return files.sort();
}

/** One pass: send the named files to the bound machine if the list or the machine moved. Never throws. */
async function prefetchOnce(jobsUrl: string | null): Promise<void> {
  if (!jobsUrl || running) return;
  const files = namedSongFiles();
  if (!files.length) return;
  const signature = `${jobsUrl}\n${files.join("\n")}`;
  if (signature === settled) return;
  running = true;
  try {
    await requestJobAt(
      jobsUrl,
      { type: "prefetch", files },
      (r) => r.type === "prefetched",
    );
    settled = signature;
    lastError = "";
  } catch (e) {
    const message = e instanceof JobError ? e.message : String(e);
    if (message !== lastError) console.warn(`   mediatek prefetch: ${message}`);
    lastError = message;
  } finally {
    running = false;
  }
}

/** Runs prefetchOnce on a timer against whatever machine is bound at each tick; unref'd. */
export function startPrefetch(jobsUrl: () => string | null): void {
  if (timer) return;
  setTimeout(() => void prefetchOnce(jobsUrl()), FIRST_MS).unref();
  timer = setInterval(() => void prefetchOnce(jobsUrl()), EVERY_MS);
  timer.unref();
}
