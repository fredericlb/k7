// disk.ts — a workspace file read back over HTTP, to see an edit landed, and a fixture project put back before a test edits it.
// Reads ask with the PAGE's cookies, so they see what the account driving the screen wrote, on whichever target.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FileService } from "./files.ts";
import { FIXTURES_DIR } from "./fixtures.ts";

/** The text of `path` in `workspace`, read with the page's own session. */
export async function readFile(
  page: Page,
  workspace: string,
  path: string,
): Promise<string> {
  return (await FileService.ofPage(page)).readText(workspace, path);
}

/** Waits until `path` reads `want`: a save is debounced, so the disk lags the screen. */
export async function expectFile(
  page: Page,
  workspace: string,
  path: string,
  want: RegExp | ((text: string) => boolean),
  timeout = 15_000,
): Promise<string> {
  let last = "";
  await expect
    .poll(
      async () => {
        last = await readFile(page, workspace, path);
        return typeof want === "function" ? want(last) : want.test(last);
      },
      { message: `${path} never matched ${want}`, timeout },
    )
    .toBe(true);
  return last;
}

function walk(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name;
    return statSync(join(dir, name)).isDirectory()
      ? walk(join(dir, name), path)
      : [path];
  });
}

/** Writes every text file of fixture `project` back over what a previous test left: the seed runs once per run, not per test. */
export async function restoreProject(
  files: FileService,
  workspace: string,
  project: string,
): Promise<void> {
  const root = join(FIXTURES_DIR, project);
  for (const path of walk(root))
    await files.writeText(
      workspace,
      `${project}/${path}`,
      readFileSync(join(root, path), "utf8"),
    );
}
