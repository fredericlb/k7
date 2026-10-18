# The end-to-end run — the desktop app booted for real

```bash
npm run build:main --workspace k7-standalone       # from the checkout: main bundle…
npm run build:frontends --workspace k7-standalone  # …and k7's frontend, then:
npm run e2e --workspace k7-standalone              # the packaged app in out/ when there is one, the checkout's otherwise
```

`e2e/app.e2e.ts` starts the app, waits for its window to reach k7's home page, for the engine to run
and register, for the `k7-core` library to be seeded, then quits it and checks that nothing still
listens. The unit suites cannot see any of that: it is the seam between the shell, the backend it
starts, the supervisor and the window.

## Playwright, driving Electron itself

Playwright's `_electron.launch` attaches to the main process and to every page, the
`WebContentsView` tabs included, so a test reads the same `window.studioEngine` bridge the pages
do (`src/engineBridge.ts`) instead of a back door of its own. Its Electron support is labelled
experimental; WebdriverIO's Electron service is the supported alternative, and it is heavier and
a second test framework beside vitest. Specs are named `*.e2e.ts` so vitest never runs them.

## Every launch gets its own user-data folder

`--user-data-dir` moves `app.getPath("userData")`, so a run starts with no library, no session and
no window state, and leaves the developer's own app alone. It also matters for a reason that is
not obvious: Electron's single-instance lock is keyed on that folder, and without it a test launched
beside a running k7 is the second instance and exits at once.

The port is NOT per launch: the backend's 18789 is fixed (`apps/k7/backend/standalone.json`), so
the run has one worker and the app refuses to start while anything else holds that port.

## The library is seeded on a page's request, not at boot

The hub copies `k7-core` when the home page asks it to sync (`packages/file-hub/libraries.ts`),
so the test waits for the folder after the home page loads rather than right after the backend
answers.

## No supervisor: a skip locally, a failure on CI

Run from a checkout with no C++ build, the app starts without an engine on purpose
(`docs/engine.md`), and the engine step is skipped. CI sets `K7_E2E_ENGINE=1`, under which the same
state fails at once: a packaged app without its supervisor is a broken package.

## On GitHub

The `desktop` job of `.github/workflows/desktop-platform.yml` runs it against the app it just
packaged, on all three runners, and uploads `test-results/` as `k7-e2e-<platform>`. The Linux
runner needs three things the others have: user namespaces for Chromium's sandbox, which Ubuntu
24.04's AppArmor withholds by default; a display, given by `xvfb-run`; and a sound card, given by a
PulseAudio null sink exactly as the server's engine image does (`engine/docker/asound.conf`). The
step is `continue-on-error` until it has been green on every runner, so it reports without
holding back a release.

## The feature specs run here too

This run checks the app's own seams. The feature projects and the specs that open them live in
the functional suite, which also runs inside this app: `npm run test:e2e:desktop` launches it with
`e2e/launch.ts` (`e2e/docs/e2e.md`).
