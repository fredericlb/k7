// shareProgress.ts — where a share being made is, as ONE bar and one sentence: the job's steps weighted by how long
// each takes, the VST renders and the upload being the long ones. Pure, so it is tested without a screen.
// See packages/file-service/docs/share.md.

import type { ShareProgress, ShareStep } from "@studio/web-protocol";
import { m } from "./paraglide/messages.js";

/** Each step's share of the bar, in order: [where it starts, how much of it it covers]. */
const SPAN: Partial<Record<ShareStep, [number, number]>> = {
  freeze: [0, 50],
  sync: [50, 5],
  checkpoint: [55, 3],
  pack: [58, 7],
  upload: [65, 35],
};

/** The bar's fill, 0–100; a step that counts nothing yet sits at its start. */
export function shareProgressPct(p: ShareProgress): number {
  if (p.step === "done") return 100;
  const span = SPAN[p.step];
  if (!span) return 0;
  const within = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return Math.round(span[0] + span[1] * within);
}

const mb = (n: number) => (n / 1048576).toFixed(1);

/** What the author reads beside the bar. */
export function shareProgressLine(p: ShareProgress): string {
  switch (p.step) {
    case "freeze":
      return p.total > 0
        ? m["share.stepFreeze"]({
            done: p.done,
            total: p.total,
            module: p.detail ?? "",
          })
        : m["share.stepFreezeCheck"]();
    case "sync":
      return m["share.stepSync"]();
    case "checkpoint":
      return m["share.stepCheckpoint"]();
    case "pack":
      return m["share.stepPack"]();
    case "upload":
      return m["share.stepUpload"]({ done: mb(p.done), total: mb(p.total) });
    case "failed":
      return m["share.failed"]({ error: p.error ?? "" });
    default:
      return "";
  }
}
