import { expect, test } from "../../src/target.ts";

test("probe live-video recording", async ({ k7 }) => {
  const files = await k7.files();
  await files.removeWorkspace("E2E-probe");
  await files.createWorkspace("E2E-probe");
  const { project } = await files.createProject("E2E-probe", "live-video", "probe.k7");
  const page = await k7.open(`/@local/E2E-probe/${project}`);
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const log: string[] = [];
    w.__log = log;
    const MR = window.MediaRecorder;
    window.MediaRecorder = class extends MR {
      constructor(s: MediaStream, o?: MediaRecorderOptions) {
        super(s, o);
        log.push(`new MR tracks=${s.getVideoTracks().length} mime=${o?.mimeType}`);
        this.addEventListener("start", () => log.push("start"));
        this.addEventListener("dataavailable", (e) => log.push(`data ${(e as BlobEvent).data.size}`));
        this.addEventListener("stop", () => log.push("stop"));
        this.addEventListener("error", (e) => log.push(`error ${String(e)}`));
      }
    } as typeof MediaRecorder;
    const cs = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (fps?: number) {
      log.push(`captureStream ${this.width}x${this.height}`);
      return cs.call(this, fps);
    };
  });
  await expect(page.getByRole("button", { name: "Engine", exact: true })).toHaveAttribute("title", /Engine connected/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Record the output", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(4_000);
  console.log("during:", await page.evaluate(() => JSON.stringify((window as never as Record<string, unknown>).__log)));
  console.log("offscreen:", await page.evaluate(() => [...document.querySelectorAll("div")].filter((d) => d.style.position === "fixed" && Number.parseFloat(d.style.left) < -1000).map((d) => `${d.style.left} ${d.style.width} html=${d.innerHTML.slice(0, 300)}`).join(" || ")));
  console.log("canvases:", await page.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height} ${c.getBoundingClientRect().left}`).join(" | ")));
  await page.getByRole("button", { name: "Stop and file the recording", exact: true }).click();
  await page.waitForTimeout(8_000);
  console.log("after:", await page.evaluate(() => JSON.stringify((window as never as Record<string, unknown>).__log)));
  console.log("status:", await page.getByRole("status").allTextContents());
});
