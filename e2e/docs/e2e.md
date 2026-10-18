# The functional suite

One set of specs, `specs/app/`, run on one of two **targets**:

| target | what it drives | command |
|---|---|---|
| `web` | a **running** k7 in Playwright's Chromium: the instance `npm run dev` serves, `https://app.priv.k7.rocks` by default, or `E2E_BASE_URL` | `npm run test:e2e` |
| `desktop` | k7 the desktop app, started by the run itself in Electron | `npm run test:e2e:desktop` |

```bash
npm run e2e:install --workspace @studio/e2e   # once, for the web target: Playwright's Chromium
npm run test:e2e                              # every spec, on the web
npm run test:e2e -- specs/app/transport.spec.ts

npm run build:main --workspace k7-standalone       # the desktop target runs the checkout's app…
npm run build:frontends --workspace k7-standalone  # …or the packaged one under apps/k7-standalone/out/
npm run test:e2e:desktop
```

Neither is part of `npm run test`, whose workspaces run vitest: both need an engine, which a unit run
must never need. A failed spec keeps its trace under `e2e/test-results/`; the HTML report is
`e2e/report/` (`report/desktop/` for the app). Requests answered 4xx and console errors do not fail a
spec: they are listed on the report as `noted` annotations, since some 4xx are the app asking whether
a file exists.

## One `test`, bound to a target when the suite loads

Specs import `test` from `src/target.ts`, never from `@playwright/test`, and drive a `k7` fixture:
`k7.open(path)` for a page, `k7.landed(from, at)` for the page a click led to, `k7.files()` for the
file service. They never call `page.goto`, because the two targets do not agree on what a page is:
on the web a project replaces the page, while the app opens it in a tab of its own, a separate
page Playwright sees appear. The desktop `open` therefore navigates the way a link does, from inside
the home tab, so the app's own routing turns it into a tab (`apps/k7-standalone/docs/tabs.md`), and
it closes the tabs a test opened when the test ends.

The target is chosen by `E2E_TARGET`, which `playwright.desktop.config.ts` sets, rather than by a
Playwright option: a fixture's dependencies are fixed when it is declared, so one `test` serving both
would make the desktop run start Chromium too.

## The web target signs in without the identity provider

The instance signs its session cookie with its `SESSION_SECRET`, and that secret is in this machine's
`env.yaml`. `src/session.ts` signs one the same way, with `sessionCookieHeader` from
`@frediverse/oidc` — the helper that exists so tests do not hand-roll the encoding. So there is no
password to store and no login page to script, and the suite cannot sign in anywhere whose secret is
not on disk here: it is a local tool by construction.

It signs in as a dedicated account, `sub: "e2e"`. The file hub gives that account a workspace of
its own, seeded with the `Examples` projects, so a spec that writes never touches a person's work.

## The desktop target is one app per worker

The app runs as its local user (`apps/k7-standalone/docs/signIn.md`), so there is no session to
mint. Each launch gets a user-data folder of its own (`apps/k7-standalone/docs/e2e.md`), which means
an app starts with no workspace but `Examples`, and the fixtures are seeded into **that** app by the
worker that launched it, not by a setup project, which would run in a worker and an app of its own.
Playwright replaces a worker after a failed test, so each failure costs a launch, a plugin scan and
a seed: about fifteen seconds.

The app's backend port is fixed, so nothing else may hold `127.0.0.1:18789` during a run, and a
checkout without a supervisor build fails the run at once with the engine's reason.

## Feature projects

`fixtures/` holds one small project per feature, and `fixtures/README.md` is the table of which is
which. They are written into a workspace of their own, `E2E`, before every run. Writing goes over
HTTP, through the same routes the browser uses: the workspace is removed and recreated with
`/workspaces/remove` and `/workspaces`, never deleted on disk, because the live-sync relay restores a
folder that disappears behind its back.

The service validates nothing on write, so whether a fixture is a valid project is a test of its
own (`specs/app/fixtures.spec.ts`), separate from what the screen does with it
(`specs/app/features.spec.ts`).

A spec that has found a bug keeps asserting the right behaviour under `test.fail`, with the bug in
its reason: the run stays green, and turns red the day the bug is fixed, which is the reminder to
drop the mark.

## Play is pressed once, when it is offered

"engine connected" shows before the project has reached the engine: the files still cross the tunnel,
and the engine replaces its edit when they land, which drops a transport already rolling. The header
therefore names the button "loading the project", disabled, until the file service says the project
is playable (`apps/k7/frontend/docs/shell.md`). `src/transport.ts` waits for the button called Play
and presses it once: a Play that is lost again is a failure, not something to press through.

## What a web run needs from the machine

- **The dev session up** (`npm run dev`).
- **An engine listed at the instance.** On a project, the picker lists only what the registry knows,
  so the supervisor must name the instance in its config — `~/.k7/engine-host.json`:
  `{ "registryUrls": ["https://app.priv.k7.rocks"] }`. Without it every project spec stops at
  "No engines found". `node e2e/scripts/engines.ts` prints what the e2e account sees.
- **Sound is real**, on either target. The transport spec plays a few seconds of `synth-demo` through
  the engine's output device.

**The machine must stay awake.** A laptop that sleeps mid-run freezes the app and the engine, and
on waking every timer fires at once: the spec then fails on a closed page or a lost engine that are
nothing but the sleep. Run on AC power with the lid open, under `caffeinate -dims`, which does not
hold off a closed lid on battery.

One worker runs the specs in order: they share one account's workspace and one engine, which serves
one account at a time.

## Selectors

The app has almost no `data-testid`. Specs select by role and accessible name, which is what a
person reads too: a spec that cannot find a control by its name has found an accessibility gap.
