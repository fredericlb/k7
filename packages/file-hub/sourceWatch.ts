// sourceWatch.ts — DEV only: the file service's own source and every `@studio/*` package it runs,
// watched, so an edit to any of them stops the account processes and the next request starts
// them on the new code. The hub's `tsx watch` does not see these: a child PROCESS is not an
// import. Stopping beats a `tsx watch` child, which would restart under a binding the hub
// still believes it holds. See docs/fileHub.md.

import { type FSWatcher, readFileSync, realpathSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const SOURCE = /\.(ts|tsx|js|mjs|json)$/;

/** The folders of `@studio/file-service` and of every `@studio/*` package it reaches. */
export function fileServiceSourceDirs(): string[] {
  const req = createRequire(import.meta.url);
  const root = dirname(req.resolve("@studio/file-service/package.json"));
  const modules = join(root, "..", "..", "node_modules");
  const seen = new Map<string, string>();
  const visit = (name: string, dir: string): void => {
    if (seen.has(name)) return;
    seen.set(name, dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!dep.startsWith("@studio/")) continue;
      try {
        visit(dep, realpathSync(join(modules, dep)));
      } catch {
        // not linked in this install — nothing of it can be running either
      }
    }
  };
  visit("@studio/file-service", realpathSync(root));
  return [...seen.values()];
}

/** Call `onChange` once per burst of source edits under `dirs`; the return stops watching. */
export function watchSources(
  dirs: readonly string[],
  onChange: (file: string) => void,
  debounceMs = 300,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  let last = "";
  const watchers: FSWatcher[] = [];
  for (const dir of dirs) {
    try {
      watchers.push(
        watch(dir, { recursive: true }, (_event, file) => {
          const f = String(file ?? "");
          if (!SOURCE.test(f) || f.includes("node_modules")) return;
          if (/\.test\.|\.stories\./.test(f)) return;
          last = join(dir, f);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            onChange(last);
          }, debounceMs);
        }),
      );
    } catch {
      // a folder that cannot be watched is only a restart this tool will not do for you
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
