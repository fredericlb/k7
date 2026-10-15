# Rendering the picture on the server — `picture render`

`picture render [webm|mp4] [wav|none] [size=… quality=… from=… to=…]` writes
`exports/<project>.<ext>` with no browser left open. It takes the words `project export video`
takes, read by one parser (`@studio/ui-eyes/renderSettings`), so a line typed in either place
means the same render.

## The browser's compositor, in a headless Chromium

The picture is drawn by `exportScene` (`@studio/ui-eyes`), the function a browser export runs,
inside a headless Chromium driven by `playwright-core`
([src/pictureRender.ts](../src/pictureRender.ts), the page [renderPage.ts](../../ui-eyes/src/renderPage.ts)).
A second renderer written for Node — ffmpeg filter graphs, or WebGL through `headless-gl` — would
be a second copy of the shaders, the shot slots, the captions and the animation, and two copies
of a compositor drift. Running the one that exists means a server render is frame for frame what
the browser makes, and every feature the viewport gains reaches it without a line here.

What forced the browser is WebCodecs and WebGL2: `exportScene` needs both, and no Node runtime
has either.

## playwright-core, and the system's Chromium

`playwright-core` is the driver only: it downloads no browser. The st0 image is Alpine, where
Playwright's own Chromium build does not run, so the image installs Alpine's `chromium` and names
it in `STUDIO_CHROMIUM`. Without that variable, the usual install paths of Linux and macOS are
tried, and a machine with none refuses the command with the variable's name in the message.

WebGL runs on SwiftShader, on the CPU: a server has no GPU to give it. That is why a render takes
longer than the song, and why it runs in the background (`background.md`) rather than holding
the command.

An H.264 encoder depends on how the distribution built its Chromium; VP9 and Opus are in every
build. `webm` is therefore the default, and an `mp4` the build cannot encode fails with the
encoder's own message rather than producing a different file.

## A one-off server on the loopback

The page fetches everything it needs — the scene, the mixdown, the media — from an HTTP server
that lives for one render, on `127.0.0.1`, under a random path. The scene names its media by
project path, so the page needs no account, no cookie and no route of the file service's own;
nothing outside the machine can reach it, and nothing outside that path is served.
`sceneFrom` (`@studio/st0-plugins/video/sceneFrom`) is the browser-free half of the viewport's
scene builder, taking the URL scheme as a parameter, so both sides build the same scene.

The sound is the engine's own mixdown (`exportMix`), decoded in the page, as the browser export
takes it.

## What it cannot draw

A camera lane is live: it has no frame at second *t* to pull, so a render draws nothing there,
exactly as a browser export does.

`STUDIO_RENDER_DEBUG=1` logs every request the page makes, which is where a medium the page
could not fetch shows up.
