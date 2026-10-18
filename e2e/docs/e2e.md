# The functional suite

`npm run test:e2e` drives a **running** k7 in a real browser with Playwright. It does not start
the app: it tests the instance `npm run dev` already serves on this machine, `https://priv.st0.app`
by default, or `E2E_BASE_URL`. It is not part of `npm run test`, whose workspaces run vitest,
because it needs a live instance and a listed engine, which a unit run must never need.

```bash
npm run e2e:install --workspace @studio/e2e   # once: Playwright's Chromium
npm run test:e2e                              # every spec
npm run test:e2e -- specs/web/transport.spec.ts
```

A failed spec keeps its trace, screenshot and video under `e2e/test-results/`; the HTML report is
`e2e/report/`. Requests answered 4xx and console errors do not fail a spec: they are listed on the
report as `noted` annotations, since some 4xx are the app asking whether a file exists.

## Signing in without the identity provider

The instance signs its session cookie with its `SESSION_SECRET`, and that secret is in this machine's
`env.yaml`. `src/session.ts` signs one the same way, with `sessionCookieHeader` from
`@frediverse/oidc` — the helper that exists so tests do not hand-roll the encoding. So there is no
password to store and no login page to script, and the suite cannot sign in anywhere whose secret is
not on disk here: it is a local tool by construction.

It signs in as a dedicated account, `sub: "e2e"`. The file hub gives that account a workspace of
its own, seeded with the `Examples` projects, so a spec that writes never touches a person's work.

## Feature projects

`fixtures/` holds one small project per feature, and `fixtures/README.md` is the table of which is
which. The `seed` step writes them into a workspace of their own, `E2E`, before every run. Writing
goes over HTTP, through the same routes the browser uses: the workspace is removed and recreated with
`/workspaces/remove` and `/workspaces`, never deleted on disk, because the live-sync relay restores a
folder that disappears behind its back.

The service validates nothing on write, so whether a fixture is a valid project is a test of its
own (`specs/web/fixtures.spec.ts`), separate from what the screen does with it
(`specs/web/features.spec.ts`).

A spec that has found a bug keeps asserting the right behaviour under `test.fail`, with the bug in
its reason: the run stays green, and turns red the day the bug is fixed, which is the reminder to
drop the mark.

## What a run needs from the machine

- **The dev session up** (`npm run dev`).
- **An engine listed at the instance.** On a project, the picker lists only what the registry knows,
  so the supervisor must name the instance in its config — `~/.k7/engine-host.json`:
  `{ "registryUrls": ["https://priv.st0.app"] }`. Without it every project spec stops at
  "No engines found". `node e2e/scripts/engines.ts` prints what the e2e account sees.
- **Sound is real.** The transport spec plays a few seconds of `synth-demo` through the engine's
  output device.

One worker runs the specs in order: they share one account's workspace and one engine, which serves
one account at a time.

## Selectors

The app has almost no `data-testid`. Specs select by role and accessible name, which is what a
person reads too: a spec that cannot find a control by its name has found an accessibility gap.
