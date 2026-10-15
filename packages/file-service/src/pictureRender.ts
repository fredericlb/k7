// pictureRender.ts — the picture rendered with NO browser left open: headless Chromium runs the
// same compositor and `exportScene` a browser export does, fed by a one-off HTTP server on the
// loopback that serves the render page, the scene, the mixdown and the media, and takes back the
// finished file. Frame for frame what a browser makes; slower, its WebGL running on the CPU.
// See docs/serverRender.md.

import { randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";
import { sceneFrom } from "@studio/st0-plugins/video/sceneFrom";
import type { Workspace } from "./workspace.ts";

/** What a server render is asked for: the export's own words. */
export interface PictureRenderOptions {
  format: "webm" | "mp4";
  audio: boolean;
  from?: number;
  to?: number;
  size?: { height: number } | { width: number; height: number };
  quality?: "low" | "medium" | "high" | "max";
}

/** Where a Chromium is looked for when STUDIO_CHROMIUM names none: the image's, then a desktop's. */
const CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

/** The browser to render in, or a sentence saying why there is none. */
export function findChromium(): string {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the image, or by whoever runs this service
  const named = process.env.STUDIO_CHROMIUM;
  if (named) {
    if (existsSync(named)) return named;
    throw new Error(`STUDIO_CHROMIUM names ${named}, which is not there`);
  }
  const hit = CHROMIUM_CANDIDATES.find((p) => existsSync(p));
  if (!hit)
    throw new Error(
      "no Chromium to render in — install it, or set STUDIO_CHROMIUM to one",
    );
  return hit;
}

// The render page, bundled ONCE per process: it is the same source whatever is rendered.
let pageScript: Promise<string> | null = null;
function renderScript(): Promise<string> {
  pageScript ??= (async () => {
    const { build } = await import("esbuild");
    const entry = new URL(import.meta.resolve("@studio/ui-eyes/renderPage"))
      .pathname;
    const out = await build({
      entryPoints: [entry],
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      logLevel: "silent",
    });
    return out.outputFiles[0]?.text ?? "";
  })();
  return pageScript;
}

const PAGE = `<!doctype html><html><body><script src="page.js"></script></body></html>`;

// One file, with the Range support mediabunny's reader asks for: it reads a container in pieces.
function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  abs: string,
  type: string,
): void {
  // Only a FILE: an empty path names the workspace itself, and a stream over a folder throws.
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const size = statSync(abs).size;
  // A stream that fails mid-way ends this response, never the service (docs/background.md).
  const stream = (opts?: { start: number; end: number }) =>
    createReadStream(abs, opts).on("error", () => res.destroy());
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1]
      ? Number(range[1])
      : Math.max(0, size - Number(range[2]));
    const end =
      range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
    });
    stream({ start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": size,
    "accept-ranges": "bytes",
  });
  stream().pipe(res);
}

const body = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });

/** Render the active project's picture into `exports/`, in headless Chromium; the written file, project-relative. */
export async function renderPicture(
  ws: Workspace,
  opts: PictureRenderOptions,
  onProgress: (frame: number, total: number) => void = () => {},
): Promise<string> {
  const project = ws.activeProjectPath();
  if (!project) throw new Error("no active project to render");
  const doc = ws.videoProjectDoc();
  if (!doc.videoTracks.length)
    throw new Error("this project draws no picture — nothing to render");
  const executablePath = findChromium();
  const script = await renderScript();
  const token = randomUUID();
  // Every URL the scene names is under the job's own path, so the page needs no account, no cookie.
  const scene = sceneFrom(
    doc,
    null,
    "export",
    (p: string) => `media/${encodeURIComponent(p)}`,
  );
  const from = opts.from ?? 0;
  const to = opts.to ?? scene.durationSec;
  const frameCount = Math.max(1, Math.round((to - from) * scene.fps));
  const [vw, vh] = scene.viewport;
  const size: [number, number] | undefined = !opts.size
    ? undefined
    : "width" in opts.size
      ? [opts.size.width, opts.size.height]
      : [Math.round((opts.size.height * vw) / vh), opts.size.height];
  const mix = opts.audio ? await ws.exportMix("wav") : null;
  let settle: {
    done: (b: Buffer, type: string) => void;
    fail: (e: Error) => void;
  } | null = null;
  const finished = new Promise<{ bytes: Buffer; type: string }>(
    (resolve, reject) => {
      settle = {
        done: (bytes, type) => resolve({ bytes, type }),
        fail: reject,
      };
    },
  );
  const server = createServer(async (req, res) => {
    const prefix = `/${token}/`;
    const url = req.url ?? "";
    if (!url.startsWith(prefix)) return void res.writeHead(404).end();
    const route = decodeURIComponent(
      url.slice(prefix.length).split("?")[0] ?? "",
    );
    // A render is a headless page nobody watches: this is how one says what it asked for.
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: a diagnostic switch, set by hand
    if (process.env.STUDIO_RENDER_DEBUG)
      console.log(`render: ${req.method} ${route} ${req.headers.range ?? ""}`);
    try {
      if (route === "")
        return void res
          .writeHead(200, { "content-type": "text/html" })
          .end(PAGE);
      if (route === "page.js")
        return void res
          .writeHead(200, { "content-type": "text/javascript" })
          .end(script);
      if (route === "job.json")
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              scene,
              format: opts.format,
              audio: !!mix,
              from,
              frameCount,
              ...(size ? { size } : {}),
              ...(opts.quality ? { quality: opts.quality } : {}),
            }),
          );
      if (route === "mix.wav" && mix)
        return sendFile(req, res, mix.path, "audio/wav");
      if (route.startsWith("media/"))
        return sendFile(
          req,
          res,
          ws.mediaPath(route.slice(6)),
          "application/octet-stream",
        );
      if (req.method === "POST" && route === "progress") {
        const p = JSON.parse((await body(req)).toString()) as {
          frame: number;
          total: number;
        };
        onProgress(p.frame, p.total);
        return void res.writeHead(204).end();
      }
      if (req.method === "POST" && route === "result") {
        settle?.done(
          await body(req),
          String(req.headers["content-type"] ?? ""),
        );
        return void res.writeHead(204).end();
      }
      if (req.method === "POST" && route === "error") {
        settle?.fail(
          new Error((await body(req)).toString() || "the render page failed"),
        );
        return void res.writeHead(204).end();
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end((e as Error).message);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const { chromium } = await import("playwright-core");
  // WebGL on SwiftShader: a server has no GPU, and the compositor needs a WebGL2 context all the same.
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => settle?.fail(e));
    await page.goto(`http://127.0.0.1:${port}/${token}/`);
    const { bytes, type } = await finished;
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const name = basename(project).replace(/\.st0$/, "") || "picture";
    mkdirSync(join(project, "exports"), { recursive: true });
    const rel = `exports/${name}.${ext}`;
    writeFileSync(join(project, rel), bytes);
    return rel;
  } finally {
    await browser.close();
    server.close();
    mix?.cleanup();
  }
}
