// launch.ts — start k7 the desktop app for a test: the packaged build under out/ when there is one, the checkout's otherwise.
// Every launch gets a user-data folder of its own, which is also what keys Electron's single-instance lock — docs/e2e.md.

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  type Page,
} from "@playwright/test";
import standalone from "../../k7/backend/standalone.json";

export const K7 = `http://127.0.0.1:${standalone.port}`;

// Playwright compiles the specs as CommonJS here, so there is no import.meta.
const APP_DIR = join(__dirname, "..");

/** The packaged app's executable under out/, or null: electron-builder names it per platform. */
function packagedExecutable(): string | null {
  const override = process.env.K7_E2E_APP;
  if (override) return override;
  const out = join(APP_DIR, "out");
  if (!existsSync(out)) return null;
  const candidates: string[] = [];
  for (const dir of readdirSync(out)) {
    if (process.platform === "darwin" && dir.startsWith("mac"))
      candidates.push(join(out, dir, "k7.app", "Contents", "MacOS", "k7"));
    if (process.platform === "win32" && dir === "win-unpacked")
      candidates.push(join(out, dir, "k7.exe"));
    // Linux names the executable after package.json's name, not the product name.
    if (process.platform === "linux" && dir === "linux-unpacked")
      candidates.push(join(out, dir, "k7-standalone"), join(out, dir, "k7"));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

export interface Launched {
  app: ElectronApplication;
  userData: string;
}

/** Launch the app on a fresh user-data folder. */
export async function launchApp(): Promise<Launched> {
  const userData = mkdtempSync(join(tmpdir(), "k7-e2e-"));
  const flags = [`--user-data-dir=${userData}`];
  const executablePath = packagedExecutable();
  const env = { ...process.env } as Record<string, string>;
  // VS Code's terminals export it, and with it set Electron is plain node and opens no window.
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    executablePath
      ? { executablePath, args: flags, env }
      : { args: [APP_DIR, ...flags], cwd: APP_DIR, env },
  );
  return { app, userData };
}

/** The last lines of the app's log, for an error that would otherwise only say it timed out. */
function logTail(userData: string, lines = 40): string {
  const log = join(userData, "standalone.log");
  if (!existsSync(log)) return "(no standalone.log)";
  return readFileSync(log, "utf8").split("\n").slice(-lines).join("\n");
}

/** The home tab once it shows k7: a page of the app's origin that is neither the tab strip nor the sign-in hop. */
export async function homePage(
  { app, userData }: Launched,
  timeoutMs: number,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const url = page.url();
      // The shell paints its failure page while its Retry / Quit dialog waits: nothing will come after it.
      if (url.startsWith("data:") && url.includes("could%20not%20start"))
        throw new Error(`k7 could not start:\n${logTail(userData)}`);
      if (!url.startsWith(`${K7}/`)) continue;
      const path = new URL(url).pathname;
      if (path.startsWith("/@tabs") || path.startsWith("/auth")) continue;
      return page;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const seen = app.windows().map((p) => p.url());
  throw new Error(
    `no k7 page within ${timeoutMs} ms; pages: ${seen.join(", ")}`,
  );
}
