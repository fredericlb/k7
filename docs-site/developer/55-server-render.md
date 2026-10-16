# Server render: `picture render`

`picture render` produces the same file a browser export does, with no browser left open. The
file service drives a headless Chromium that runs the browser export's own code.

## Why a browser on the server

The compositor is WebGL2 and the export is WebCodecs plus mediabunny; reimplementing either
natively would be a second renderer that drifts from the first. Running the same `exportScene` in
headless Chromium makes a server render frame for frame what a browser makes. The price is speed:
a server has no GPU, so WebGL runs on SwiftShader (`--use-angle=swiftshader
--enable-unsafe-swiftshader`), on the CPU.

## The pieces

| file | role |
|---|---|
| `packages/commands/src/verbs/pictureRender.ts` | parses `[webm\|mp4] [wav\|none] [settings]` (settings through `parseVideoSettings`), starts the work under the background tag `picture render` |
| `packages/file-service/src/engineLink.ts` | provides `renderPicture` on the command host, logging progress every 300 frames |
| `packages/file-service/src/pictureRender.ts` | `renderPicture(ws, opts, onProgress)`, `findChromium` |
| `packages/k7-plugins/src/video/sceneFrom.ts` | builds the scene, `use: "export"`, with the job's own media URLs |
| `packages/ui-eyes/src/renderPage.ts` | the page Chromium loads: fetches the job, decodes the mixdown, calls `exportScene`, posts the result |
| `packages/ui-eyes/src/renderSettings.ts` | the one parser of `size=`, `quality=`, `from=`, `to=`, shared with `project export video` |
| `apps/k7/docker/Dockerfile` | installs Alpine's `chromium` with `font-noto` and `ttf-freefont`, sets `STUDIO_CHROMIUM` |

## The job

`renderPicture`:

1. takes the workspace's **active project** and its `videoProjectDoc()`; no picture lane is an error;
2. finds Chromium: `STUDIO_CHROMIUM` when set (an error if it names nothing), else the first of
   `/usr/bin/chromium-browser`, `/usr/bin/chromium`, and the macOS Chrome and Chromium app paths;
3. bundles `@studio/ui-eyes/renderPage` with esbuild into one IIFE, **once per process**;
4. builds the scene with `sceneFrom(doc, null, "export", p => "media/" + encodeURIComponent(p))`;
5. renders the mixdown WAV (`ws.exportMix("wav")`) unless the sound is `none`;
6. starts a one-off HTTP server on `127.0.0.1`, port 0, every route under a random UUID path:

| route | serves |
|---|---|
| `/<token>/` | the HTML shell |
| `page.js` | the bundled render page |
| `job.json` | scene, format, audio flag, `from`, `frameCount`, `size`, `quality` |
| `mix.wav` | the mixdown |
| `media/<path>` | workspace media through `ws.mediaPath`, files only, with HTTP Range support (mediabunny reads containers in pieces) |
| `POST progress` | `{ frame, total }`, sent every 30th frame |
| `POST result` | the finished file; its content type picks `.mp4` or `.webm` |
| `POST error` | a failure message from the page |

7. launches Chromium through `playwright-core` (headless, the found executable), opens the page,
   awaits the result (a page error fails the job), and writes `exports/<project>.<ext>`;
8. always closes the browser and the server and removes the temporary mixdown.

The token path is the page's only credential: every URL the scene names is under it, so the page
needs no account and no cookie. A stream error mid-file ends that response, never the service.
`STUDIO_RENDER_DEBUG` logs every request the page makes.

## Running it

The command answers immediately ("rendering the picture in the background …") and a second render
while one runs is refused. The result is visible as the new file in `exports/`; progress appears in
the file service's log. To use it outside the image, install Chromium (or Chrome) on the file
service's machine or set `STUDIO_CHROMIUM`.

The behaviour is pinned by `packages/commands/src/pictureRender.test.ts`, which checks the verb's
parsing, background tagging and refusals against a fake host rather than launching a browser.
