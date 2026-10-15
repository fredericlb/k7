// renderPage.ts — the page a SERVER render runs in headless Chromium: the same `exportScene` a
// browser export calls, fed by the job server that started it and reporting back to it. It knows
// nothing of accounts or projects: the job server hands it a scene whose URLs are its own, and it
// takes the finished file. See docs/serverRender.md.

import { exportScene } from "./export";
import type { ExportQuality } from "./exportQuality";
import type { ExportFormat } from "./exportSupport";
import type { VideoScene } from "./scene";

/** What the job server hands the page: the scene, and the render's settings. */
export interface RenderJob {
  scene: VideoScene;
  format: ExportFormat;
  audio: boolean;
  from?: number;
  frameCount?: number;
  size?: [number, number];
  quality?: ExportQuality;
}

// Every route is relative to the page, which the job server serves under its own one-off path.
const post = (path: string, body: BodyInit, type: string) =>
  fetch(path, { method: "POST", body, headers: { "content-type": type } });

async function run(): Promise<void> {
  const job = (await (await fetch("job.json")).json()) as RenderJob;
  let audio: AudioBuffer | undefined;
  if (job.audio) {
    const bytes = await (await fetch("mix.wav")).arrayBuffer();
    // An OFFLINE context decodes with no output device, which a server has none of.
    audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);
  }
  const file = await exportScene(
    job.scene,
    {
      format: job.format,
      ...(audio ? { audio } : {}),
      ...(job.from !== undefined ? { from: job.from } : {}),
      ...(job.frameCount !== undefined ? { frameCount: job.frameCount } : {}),
      ...(job.size ? { size: job.size } : {}),
      ...(job.quality ? { quality: job.quality } : {}),
    },
    // Every 30th frame: enough to say how far a long render is, not a request per frame.
    (p) => {
      if (p.frame % 30 === 0 || p.frame === p.total)
        void post("progress", JSON.stringify(p), "application/json");
    },
  );
  await post("result", file.buffer, file.mimeType);
}

run().catch((e: unknown) => {
  void post("error", e instanceof Error ? e.message : String(e), "text/plain");
});
