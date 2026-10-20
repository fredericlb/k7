// fixtures.ts — the feature projects under e2e/fixtures/, written into the e2e account's workspace before a run.
// One folder per feature; README.md beside them says which feature each one exercises (fixtures/README.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { FileService } from "./files.ts";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");
export const FIXTURES_WORKSPACE = "E2E";

// The extensions the file service refuses as text and takes only through /upload (workspaceFilter.ts).
const BINARY = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".vstpreset",
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every fixture project, by folder name (`<name>.k7`). */
export function fixtureProjects(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((n) => n.endsWith(".k7"))
    .sort();
}

/** Recreates the workspace from scratch and writes every fixture file into it. */
export async function seedFixtures(
  files: FileService,
  workspace = FIXTURES_WORKSPACE,
) {
  await files.removeWorkspace(workspace);
  await files.createWorkspace(workspace);
  // A recreated workspace can keep its old library pin; the fixtures are written for the newest @k7-core.
  const upgrade = await files.command(workspace, "library upgrade k7-core");
  if (upgrade.refused)
    throw new Error(
      `library upgrade refused: ${JSON.stringify(upgrade.output)}`,
    );
  for (const file of walk(FIXTURES_DIR)) {
    const path = relative(FIXTURES_DIR, file).split("\\").join("/");
    if (path === "README.md") continue;
    if (BINARY.has(extname(path).toLowerCase()))
      await files.upload(workspace, path, readFileSync(file));
    else await files.writeText(workspace, path, readFileSync(file, "utf8"));
  }
}
