// target.ts — the suite's `test`, bound once to a TARGET: a live instance in Chromium, the desktop app in Electron, or a phone.
// Specs ask `k7.open(path)` for a page instead of `page.goto`, because in the app a project opens in a tab of its own (docs/e2e.md).
import {
  type APIRequestContext,
  test as base,
  expect,
  type Page,
  request,
} from "@playwright/test";
import {
  closeApp,
  engineState,
  homePage,
  type Launched,
  launchApp,
} from "../../apps/k7-standalone/e2e/launch.ts";
import { android } from "./android.ts";
import { FileService } from "./files.ts";
import { seedFixtures } from "./fixtures.ts";

export { expect };

export type Target = "web" | "desktop" | "android";

/** Set by playwright.desktop.config.ts or playwright.android.config.ts before any spec loads; the web is the default. */
export const TARGET: Target =
  process.env.E2E_TARGET === "desktop" || process.env.E2E_TARGET === "android"
    ? process.env.E2E_TARGET
    : "web";

/** What a spec drives, whichever target it runs on. */
export interface K7 {
  target: Target;
  /** A page showing `path`: the one page on the web, the tab holding it in the app. */
  open(path: string): Promise<Page>;
  /** The page showing an address matching `at` after something on `from` navigated there. */
  landed(from: Page, at: RegExp): Promise<Page>;
  /** The signed-in account's file service, reached over HTTP as the browser reaches it. */
  files(): Promise<FileService>;
}

const web = base.extend<{ k7: K7 }>({
  k7: async ({ page, request }, use) => {
    await use({
      target: "web",
      async open(path) {
        await page.goto(path);
        return page;
      },
      async landed(from, at) {
        await expect(from).toHaveURL(at);
        return from;
      },
      files: () => FileService.connect(request),
    });
  },
});

/** A cold first boot starts the engine and seeds the library: a minute on a slow machine. */
const BOOT_MS = 120_000;

interface Desktop {
  launched: Launched;
  home: Page;
  request: APIRequestContext;
}

/** Waits for the app's own engine to run and answer, and says why when it never will. */
async function engineUp(home: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await engineState(home);
        if (s.down) return s.down;
        if (!s.snapshot) return "no snapshot yet";
        if (s.snapshot.error) return s.snapshot.error;
        if (s.snapshot.status !== "running") return s.snapshot.status;
        if (!s.snapshot.lastHeartbeatOk) return "running, no heartbeat yet";
        return s.snapshot.enginePort > 0 ? "up" : "running, no port yet";
      },
      {
        message:
          "the app's engine never came up (a checkout needs a supervisor build)",
        timeout: BOOT_MS,
        intervals: [1000],
      },
    )
    .toBe("up");
}

/** The project tabs a test opened, so the next test starts with the home tab alone. */
async function closeTab(page: Page): Promise<void> {
  if (page.isClosed()) return;
  // The tab takes the shortcut itself, before the menu: one press closes this one tab (apps/k7-standalone/docs/tabs.md).
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+W" : "Control+W",
  );
  await page.waitForEvent("close", { timeout: 10_000 }).catch(() => undefined);
}

const desktop = base.extend<{ k7: K7 }, { desktop: Desktop }>({
  desktop: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright refuses a fixture whose fixtures argument is not destructured.
    async ({}, use) => {
      const launched = await launchApp();
      try {
        const home = await homePage(launched, BOOT_MS);
        await expect(home).toHaveURL(`${launched.origin}/`, {
          timeout: BOOT_MS,
        });
        await engineUp(home);
        // The local user's session lives in the app's cookie jar; the file service is asked with the same one.
        const cookies = await launched.app.context().cookies();
        const api = await request.newContext({
          baseURL: launched.origin,
          storageState: { cookies, origins: [] },
        });
        // Seeded here, in the one app the specs then drive: a launch starts from an empty user-data folder.
        const files = await FileService.connect(api);
        // The hub copies the k7-core seed in the background, and a workspace is refused until it lands.
        await expect
          .poll(() => files.libraries(), {
            message: "the app's k7-core library was never seeded",
            timeout: BOOT_MS,
            intervals: [500],
          })
          .toContain("k7-core");
        await seedFixtures(files);
        await use({ launched, home, request: api });
        await api.dispose();
      } finally {
        await closeApp(launched);
      }
    },
    { scope: "worker", timeout: 4 * BOOT_MS },
  ],
  k7: async ({ desktop: d }, use) => {
    const opened = new Set<Page>();
    const tabAt = async (at: (url: URL) => boolean): Promise<Page> => {
      let found: Page | undefined;
      await expect
        .poll(
          () => {
            found = d.launched.app.windows().find((p) => {
              if (p.isClosed() || !p.url().startsWith(`${d.launched.origin}/`))
                return false;
              const url = new URL(p.url());
              return !url.pathname.startsWith("/@tabs") && at(url);
            });
            return found !== undefined;
          },
          { message: "no tab came to show it", timeout: 30_000 },
        )
        .toBe(true);
      if (found !== d.home) opened.add(found as Page);
      return found as Page;
    };
    await use({
      target: "desktop",
      async open(path) {
        const url = new URL(path, d.launched.origin);
        if (!url.pathname.startsWith("/@")) {
          await d.home.goto(url.href);
          return d.home;
        }
        // A page-initiated navigation, as a link is: the app cancels it and opens or selects the project's tab.
        await d.home.evaluate((href) => {
          const page = globalThis as unknown as {
            location: { assign(to: string): void };
          };
          page.location.assign(href);
        }, url.href);
        const want = url.pathname.replace(/\/$/, "");
        return tabAt((u) => u.pathname.startsWith(want));
      },
      landed: (_from, at) => tabAt((u) => at.test(u.href)),
      files: () => FileService.connect(d.request),
    });
    for (const page of opened) await closeTab(page);
  },
});

/** The `test` every spec imports: one of the three, chosen when the suite loads. */
export const test = (
  TARGET === "desktop" ? desktop : TARGET === "android" ? android : web
) as typeof web;
