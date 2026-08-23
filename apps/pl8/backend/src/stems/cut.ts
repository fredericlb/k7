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
import { STEMS_DIR } from "@studio/song-schema/stems";
import {
  ENGINE_TOKEN_HEADER,
  type SeparateJob,
  USER_HEADER,
} from "@studio/web-protocol";

/** How often the engine is asked where a cut got to. A separation is minutes, so this is not a
 *  hot loop — it is slow enough to cost nothing and quick enough to feel finished. */
const POLL_MS = 2000;
/** Past any honest run, and only here to stop a wedged engine holding a request for ever. The
 *  engine has its own, shorter, cap; this one catches an engine that stopped answering at all. */
const GIVE_UP_MS = 90 * 60 * 1000;

/**
 * Where a registered engine's file service answers.
 *
 * Loopback FIRST, and on this dev machine that is the only one that means anything — pl8 and the
 * engine are the same box. A LAN address is what a hosted pl8 would need, and it is tried in
 * turn rather than chosen cleverly: an engine advertises the addresses it has, and the first that
 * answers is the one that works.
 */
export function fileServiceBases(engine: EngineEntry): string[] {
  const { loopback, lanIps, filePort } = engine.addresses;
  return [loopback, ...lanIps]
    .filter(Boolean)
    .map((host) => `http://${host}:${filePort}`);
}

export class CutError extends Error {}

/**
 * The stems this song already has, by filename — empty when it has none.
 *
 * Asked of the FOLDER rather than of a record somewhere, for the reason every freshness question
 * in this repo is asked that way: the files are the truth, and a record beside them is a second
 * one that can disagree. Exported because the route answers "already done" BEFORE it looks for an
 * engine — a prepared song needs no machine at all.
 */
export function heldStems(song: string): string[] {
  const outDir = join(dirname(safePath(song)), STEMS_DIR);
  return existsSync(outDir) ? readdirSync(outDir).filter(isAudio) : [];
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

/**
 * Cut one song into stems and keep them beside it.
 *
 * `song` is volume-relative — `songs/<artiste>/<album>/<titre>/original.mp3`, the same string
 * every other route here takes — and `safePath` is what confines it. The stems land in
 * `stems/` under the song's own folder, never beside the master: the scan takes the FIRST audio
 * file in a folder and does not descend, so a stem alongside could be played in place of the mix
 * (@studio/song's stems.ts holds that rule for everyone).
 *
 * Already done is not an error and not work: a folder with audio in it answers immediately. Asked
 * of the FOLDER rather than of a record somewhere, for the reason every freshness question in
 * this repo is — the files are the truth.
 */
export async function cutStems(opts: {
  engine: EngineEntry;
  userEmail: string;
  song: string;
  chain: string;
  onProgress?: (job: SeparateJob) => void;
}): Promise<{ ready: true; files: string[] }> {
  const { engine, userEmail, song, chain } = opts;
  const source = safePath(song);
  if (!existsSync(source)) throw new CutError(`${song} is not on this volume`);

  // `dirname`, not a slice on "/": `safePath` answers in the platform's separators, and on
  // Windows that is a backslash — a hand-rolled split would put `stems/` at the volume root.
  const outDir = join(dirname(source), STEMS_DIR);
  const held = heldStems(song);
  if (held.length) return { ready: true, files: held };

  const bases = fileServiceBases(engine);
  if (!bases.length)
    throw new CutError("that engine advertises no address to reach it on");

  // The BYTES, in the request body. The engine holds no copy of this library — that is the whole
  // point of driving the cut from here — so the master travels once, per job, and is thrown away
  // with the scratch directory when the files have been collected.
  const audio = await readFile(source);
  const name = song.slice(song.lastIndexOf("/") + 1);

  let base = "";
  let job: SeparateJob | null = null;
  let lastError = "";
  for (const candidate of bases) {
    try {
      const res = await fetch(
        `${candidate}/process?chain=${encodeURIComponent(chain)}&name=${encodeURIComponent(name)}`,
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
        // A refusal is the engine ANSWERING — a chain that is not there, a model nobody
        // downloaded — so it is reported rather than treated as an address that did not work.
        // Trying the next address would turn a fixable sentence into "no engine responded".
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
    // Forwarded VERBATIM — phase, percent and the worker's own lines. What the desk draws is the
    // engine's progress, and this service is a pipe for it rather than a second opinion.
    opts.onProgress?.(job);
  }
  if (job.failed) throw new CutError(job.error ?? "the separation failed");

  // A phase of our own, and the only one: the engine is finished and the bytes are still there.
  // Named because it is minutes for a long song over a LAN, and an unlabelled gap at 100% reads
  // as a hang.
  opts.onProgress?.({ ...job, phase: "collecting", percent: null });

  // Collected one at a time and streamed to disk: four stems of a long song are hundreds of
  // megabytes, and this process serves everybody else's requests while it happens.
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

  // …and tell the engine it may drop the scratch. Best-effort: the files are HERE now, and an
  // engine that never hears this sweeps on its own an hour later.
  await fetch(`${base}/process/${job.id}`, {
    method: "DELETE",
    headers: headersFor(engine, userEmail),
  }).catch(() => {});

  return { ready: true, files: job.files };
}
