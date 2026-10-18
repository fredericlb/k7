// android.ts — the suite's `android` target: the app's e2e build on a phone, driven through its own WebView.
// That build is `se.frediver.k7.e2e` on its own port, installed BESIDE the shipped app, never over it (docs/e2e.md).
import { execFileSync } from "node:child_process";
import {
  _android,
  type AndroidDevice,
  type APIRequestContext,
  test as base,
  expect,
  type Page,
  request,
} from "@playwright/test";
import { FileService } from "./files.ts";
import { seedFixtures } from "./fixtures.ts";
import type { K7 } from "./target.ts";

export const ANDROID_PACKAGE = "se.frediver.k7.e2e";

/** The e2e build's backend port, `E2E_PORT` in engine/k7-android/app/build.gradle.kts. */
export const PHONE_PORT = 18799;
export const PHONE_ORIGIN = `http://127.0.0.1:${PHONE_PORT}`;

/** A first launch unpacks the backend and seeds the library before anything answers. */
const BOOT_MS = 180_000;

/** Runs adb against `ANDROID_SERIAL` when set, the one attached device otherwise. */
export function adb(...args: string[]): string {
  const serial = process.env.ANDROID_SERIAL;
  return execFileSync("adb", serial ? ["-s", serial, ...args] : args, {
    encoding: "utf8",
  }).trim();
}

/** What stops the phone's studio from being usable, or "up". */
async function studioState(api: APIRequestContext): Promise<string> {
  const me = await api.get("/auth/me").catch(() => null);
  if (!me) return "the backend does not answer yet";
  if (me.status() !== 200) return `/auth/me answered ${me.status()}`;
  const res = await api.get("/api/engines");
  if (!res.ok()) return `/api/engines answered ${res.status()}`;
  const engines = (await res.json()) as unknown[];
  return engines.length > 0 ? "up" : "no engine listed yet";
}

/** The page of the app's k7 view: one WebView per app shares the process's DevTools socket with the shell page. */
async function k7View(device: AndroidDevice): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        const view = device.webViews().find((w) => w.pkg() === ANDROID_PACKAGE);
        if (!view) return "no debuggable WebView (is the e2e build installed?)";
        const pages = (await view.page()).context().pages();
        found = pages.find((p) => p.url().startsWith(`${PHONE_ORIGIN}/`));
        return found
          ? "found"
          : `pages: ${pages.map((p) => p.url()).join(", ")}`;
      },
      {
        message: "the app never showed k7",
        timeout: BOOT_MS,
        intervals: [2000],
      },
    )
    .toBe("found");
  return found as Page;
}

interface Phone {
  device: AndroidDevice;
  view: Page;
  request: APIRequestContext;
}

export const android = base.extend<{ k7: K7 }, { phone: Phone }>({
  phone: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright refuses a fixture whose fixtures argument is not destructured.
    async ({}, use) => {
      const serial = process.env.ANDROID_SERIAL;
      const devices = await _android.devices({ omitDriverInstall: true });
      const device = serial
        ? devices.find((d) => d.serial() === serial)
        : devices[0];
      if (!device)
        throw new Error("no Android device: attach one or set ANDROID_SERIAL");
      adb("forward", `tcp:${PHONE_PORT}`, `tcp:${PHONE_PORT}`);
      adb(
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${ANDROID_PACKAGE}/se.frediver.k7.MainActivity`,
      );
      const api = await request.newContext({ baseURL: PHONE_ORIGIN });
      // The local user, as the app's view signs in: the same account, through a cookie of this context's own.
      await expect
        .poll(
          async () => {
            await api.get("/auth/local", { maxRedirects: 0 }).catch(() => null);
            return studioState(api);
          },
          {
            message: "the phone's studio never came up",
            timeout: BOOT_MS,
            intervals: [2000],
          },
        )
        .toBe("up");
      await seedFixtures(await FileService.connect(api));
      const view = await k7View(device);
      await use({ device, view, request: api });
      await api.dispose();
      await device.close();
    },
    { scope: "worker", timeout: 2 * BOOT_MS },
  ],
  k7: async ({ phone }, use) => {
    await use({
      target: "android",
      async open(path) {
        await phone.view.goto(new URL(path, PHONE_ORIGIN).href);
        return phone.view;
      },
      async landed(from, at) {
        await expect(from).toHaveURL(at);
        return from;
      },
      files: () => FileService.connect(phone.request),
    });
  },
});
