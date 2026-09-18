// cut.ts — separating a song, driven from HERE. pl8 holds the masters, so pl8 owns the job: it
// posts the bytes at an engine's `/process`, polls, and writes the stems back onto its own
// volume. Nothing is mirrored anywhere. See ../../docs/stems.md.

import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { EngineEntry } from "@studio/engine-registry";
import { safePath } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import {
  INSTRUMENTAL,
  outputFile,
  STEMS_DIR,
  stemsComplete,
} from "@studio/song-schema/stems";
import {
  ENGINE_TOKEN_HEADER,
  type SeparateJob,
  USER_HEADER,
} from "@studio/web-protocol";

/** How often the engine is asked where a cut got to — a separation is minutes, not a hot loop. */
const POLL_MS = 2000;
/** Past any honest run: this only catches an engine that stopped answering at all. */
const GIVE_UP_MS = 90 * 60 * 1000;

/** Where an engine's file service answers — loopback first, then each LAN address in turn. */
function fileServiceBases(engine: EngineEntry): string[] {
  const { loopback, lanIps, filePort } = engine.addresses;
  return [loopback, ...lanIps]
    .filter(Boolean)
    .map((host) => `http://${host}:${filePort}`);
}

export class CutError extends Error {}

/** The stems this song already has — asked of the FOLDER, since the files are the truth. */
export function heldStems(song: string): string[] {
  const outDir = join(dirname(safePath(song)), STEMS_DIR);
  return existsSync(outDir) ? readdirSync(outDir).filter(isAudio) : [];
}

/** What a cut can be asked for: the four parts a deck plays, or the record without its voice. */
export type CutWant = "stems" | typeof INSTRUMENTAL;

/** Is this song already cut THE WAY THIS CALLER MEANS? An instrumental is not three stems of four. */
export function heldFor(song: string, want: CutWant): boolean {
  const held = heldStems(song);
  return want === INSTRUMENTAL
    ? held.includes(outputFile(INSTRUMENTAL))
    : stemsComplete(held);
}

/** The headers the file service gates on: the engine's own token, and who is asking. */
function headersFor(
  engine: EngineEntry,
  userEmail: string,
): Record<string, string> {
  return {
    [ENGINE_TOKEN_HEADER]: engine.token,
    [USER_HEADER]: userEmail,
  };
}

/** Cut one song into stems and keep them in `stems/` under its folder — ../../docs/stems.md. */
export async function cutStems(opts: {
  engine: EngineEntry;
  userEmail: string;
  song: string;
  chain: string;
  /** What to bring back — the four stems unless the caller says otherwise. */
  want?: CutWant;
  onProgress?: (job: SeparateJob) => void;
}): Promise<{ ready: true; files: string[] }> {
  const { engine, userEmail, song, chain } = opts;
  const want = opts.want ?? "stems";
  const source = safePath(song);
  if (!existsSync(source)) throw new CutError(`${song} is not on this volume`);

  // `dirname`, not a slice on "/": `safePath` answers in the platform's own separators.
  const outDir = join(dirname(source), STEMS_DIR);
  // COMPLETE, not merely present: a folder from before the aligned master cannot cancel — docs/stemSplit.md.
  if (heldFor(song, want)) return { ready: true, files: heldStems(song) };

  const bases = fileServiceBases(engine);
  if (!bases.length)
    throw new CutError("that engine advertises no address to reach it on");

  // The BYTES, in the body: the engine holds no copy, so the master travels once per job.
  const audio = await readFile(source);
  const name = song.slice(song.lastIndexOf("/") + 1);

  let base = "";
  let job: SeparateJob | null = null;
  let lastError = "";
  for (const candidate of bases) {
    try {
      const res = await fetch(
        `${candidate}/process?chain=${encodeURIComponent(chain)}&want=${want}&name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: {
            ...headersFor(engine, userEmail),
            "content-type": "application/octet-stream",
          },
          body: audio,
        },
      );
      if (!res.ok) {
        // A refusal is the engine ANSWERING, so it is reported, not tried at the next address.
        const said = (
          (await res.json().catch(() => ({}))) as { error?: string }
        ).error;
        throw new CutError(
          said ?? `the engine refused the cut (${res.status})`,
        );
      }
      job = (await res.json()) as SeparateJob;
      base = candidate;
      break;
    } catch (e) {
      if (e instanceof CutError) throw e;
      lastError = (e as Error).message;
    }
  }
  if (!job) throw new CutError(`no engine address answered: ${lastError}`);

  opts.onProgress?.(job);
  const until = Date.now() + GIVE_UP_MS;
  while (!job.done) {
    if (Date.now() > until)
      throw new CutError(`the engine stopped answering about ${song}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetch(`${base}/process/${job.id}`, {
      headers: headersFor(engine, userEmail),
    });
    if (!res.ok)
      throw new CutError(`the engine forgot this cut (${res.status})`);
    job = (await res.json()) as SeparateJob;
    // Forwarded VERBATIM: this service is a pipe for the engine's progress, not a second opinion.
    opts.onProgress?.(job);
  }
  if (job.failed) throw new CutError(job.error ?? "the separation failed");

  // A phase of our own, and the only one — an unlabelled gap at 100% reads as a hang.
  opts.onProgress?.({ ...job, phase: "collecting", percent: null });

  // One at a time and streamed: four stems of a long song are hundreds of megabytes.
  mkdirSync(outDir, { recursive: true });
  for (const file of job.files) {
    const res = await fetch(
      `${base}/process/${job.id}/file?name=${encodeURIComponent(file)}`,
      { headers: headersFor(engine, userEmail) },
    );
    if (!res.ok || !res.body)
      throw new CutError(`the engine would not hand over ${file}`);
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(join(outDir, file)),
    );
  }

  // …and tell the engine to drop the scratch. Best-effort: it sweeps on its own an hour later.
  await fetch(`${base}/process/${job.id}`, {
    method: "DELETE",
    headers: headersFor(engine, userEmail),
  }).catch(() => {});

  return { ready: true, files: job.files };
}
