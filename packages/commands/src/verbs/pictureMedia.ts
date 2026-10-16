// pictureMedia.ts — `picture prepare <lane>`: each shot's video made fit for the picture. A probe
// says what it needs — nothing, a stream copy, a full-resolution optimized copy, a small proxy —
// and the copies are made in the BACKGROUND when the host can, since a transcode takes minutes.
// Each copy lands beside its source and is named on the clip. See packages/song-video/docs/media.md.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readYamlEntities } from "@studio/song/loader";
import type { RawClip } from "@studio/song/rawDoc";
import { setFileValue } from "@studio/song/yaml/edit";
import { VIDEO_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import { listVideoPlacements } from "@studio/song-schema/yaml/videoTrackFile";
import { planVideo } from "@studio/video-prep/plan";
import { NoFfmpegError, probeVideo } from "@studio/video-prep/probe";
import { copyPathOf, makeCopy } from "@studio/video-prep/transcode";
import type { CommandHost, SidHandler } from "../commands.ts";
import { laneFile } from "./picture.ts";
import { splitWords } from "./shared.ts";

/** The copies one clip still needs, as the work that makes them, or null when it needs none. */
async function clipWork(
  ref: string,
  clip: RawClip,
  h: CommandHost,
): Promise<{ say: string; work: (() => Promise<string>) | null }> {
  const source = String(clip.source);
  const abs = resolve(h.songPath, source);
  const facts = await probeVideo(abs);
  if (!facts) return { say: `${ref}: ${source} has no picture`, work: null };
  const plan = planVideo(facts);
  const have = (rel: string | undefined) =>
    !!rel && existsSync(resolve(h.songPath, rel));
  const wantOptimized = plan.optimized !== "none" && !have(clip.optimized);
  const wantProxy = plan.proxy && !have(clip.proxy);
  if (!wantOptimized && !wantProxy)
    return {
      say: `${ref}: ${plan.optimized === "none" && !plan.proxy ? "ready as it is" : "already prepared"}`,
      work: null,
    };
  const file = resolve(h.songPath, "clips", `${ref}.yaml`);
  const work = async () => {
    // The proxy is made from whatever DECODES: the optimized copy when there is one, which is also the faster read.
    let decodable =
      clip.optimized && have(clip.optimized) ? clip.optimized : source;
    if (wantOptimized) {
      const rel = copyPathOf(source, "optimized");
      await makeCopy(
        plan.optimized === "remux" ? "remux" : "transcode",
        abs,
        resolve(h.songPath, rel),
      );
      setFileValue(file, ["optimized"], rel);
      decodable = rel;
    }
    if (wantProxy) {
      const rel = copyPathOf(source, "proxy");
      await makeCopy(
        "proxy",
        resolve(h.songPath, decodable),
        resolve(h.songPath, rel),
      );
      setFileValue(file, ["proxy"], rel);
    }
    return `${ref}: prepared (${[wantOptimized && "optimized", wantProxy && "proxy"].filter(Boolean).join(" + ")})`;
  };
  return { say: `${ref}: ${plan.reason}`, work };
}

export const PICTURE_MEDIA_VERBS: Record<string, SidHandler> = {
  "picture.prepare": async (a, h) => {
    const laneArg = splitWords(a)[0];
    if (!laneArg) {
      h.refuse(["usage: picture prepare <lane>  (e.g. picture prepare main)"]);
      return;
    }
    const found = laneFile(laneArg, h);
    if (!found) return;
    const clips = readYamlEntities(h.songPath, "clips").values as Record<
      string,
      RawClip
    >;
    const refs = [
      ...new Set(
        listVideoPlacements(found.text)
          .map((p) => p.ref)
          .filter(Boolean),
      ),
    ];
    const lines: string[] = [];
    for (const ref of refs) {
      const clip = clips[ref];
      // A still or a missing clip has nothing to transcode; `picture add` already reported the missing one.
      if (!clip || !VIDEO_SOURCE.test(String(clip.source ?? ""))) continue;
      let job: Awaited<ReturnType<typeof clipWork>>;
      try {
        job = await clipWork(ref, clip, h);
      } catch (e) {
        if (e instanceof NoFfmpegError) {
          h.refuse([...lines, e.message]);
          return;
        }
        lines.push(`${ref}: could not read it — ${(e as Error).message}`);
        continue;
      }
      lines.push(job.say);
      if (!job.work) continue;
      // In the background where the host runs one: the request returns, and the copy shows up when it is written.
      const tag = `picture prepare ${resolve(h.songPath, String(clip.source))}`;
      if (h.background) {
        if (!h.background(tag, job.work))
          lines.push(`${ref}: already being prepared`);
        else
          lines.push(
            `${ref}: preparing in the background — the lane picks it up when it is written`,
          );
        continue;
      }
      try {
        lines.push(await job.work());
      } catch (e) {
        lines.push(`${ref}: could not prepare it — ${(e as Error).message}`);
      }
    }
    h.log(lines.length ? lines : [`nothing on ${laneArg} to prepare`]);
    return h.reload();
  },
};
