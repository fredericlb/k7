// disk.ts — a workspace file read back over HTTP, to see an edit landed, and a fixture project put back before a test edits it.
// Reads ask with the PAGE's cookies, so they see what the account driving the screen wrote, on whichever target.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FileService, type TreeNode } from "./files.ts";
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
  try {
    await expect
      .poll(
        async () => {
          last = await readFile(page, workspace, path);
          return typeof want === "function" ? want(last) : want.test(last);
        },
        { message: `${path} never matched ${want}`, timeout },
      )
      .toBe(true);
  } catch (e) {
    // The text it was left at is what tells a lost edit from a different one.
    (e as Error).message += `
${path} read last:
${last}`;
    throw e;
  }
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

/** Every `.k7x` file of the workspace tree under `prefix`. */
function k7xUnder(nodes: TreeNode[], prefix: string): string[] {
  return nodes.flatMap((n) => [
    ...(!n.dir && n.path.startsWith(prefix) && n.path.endsWith(".k7x")
      ? [n.path]
      : []),
    ...k7xUnder(n.children ?? [], prefix),
  ]);
}

/** Puts fixture `project` back over what a previous test left: its files rewritten, the `.k7x` a test added recycled. */
export async function restoreProject(
  files: FileService,
  workspace: string,
  project: string,
): Promise<void> {
  const root = join(FIXTURES_DIR, project);
  const own = walk(root);
  for (const path of own)
    await files.writeText(
      workspace,
      `${project}/${path}`,
      readFileSync(join(root, path), "utf8"),
    );
  // A node a pick wrote and no undo took back keeps its id taken: the next pick of that module is refused.
  const fixture = new Set(own.map((p) => `${project}/${p}`));
  for (const path of k7xUnder(await files.tree(workspace), `${project}/`))
    if (!fixture.has(path)) await files.deleteEntry(workspace, path);
}
