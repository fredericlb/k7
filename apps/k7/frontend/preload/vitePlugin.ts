// vitePlugin.ts — `<link rel="modulepreload">` in the built index.html for `appMain` and every chunk
// it imports statically. main.tsx reaches appMain by a dynamic import, so without these the page
// is three hops deep (HTML, entry, appMain) before the app's code starts arriving (../docs/shell.md).

import type { HtmlTagDescriptor, Plugin } from "vite";

/** The part of a Rollup output chunk this reads, so the walk is tested without a build. */
export interface PreloadChunk {
  type: "chunk" | "asset";
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: string[];
}

/** `entry`'s chunk and its static imports, minus what the HTML's own entry already preloads. */
export function preloadFiles(
  bundle: Record<string, PreloadChunk>,
  entry: string,
): string[] {
  const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const closure = (start: PreloadChunk): Set<string> => {
    const seen = new Set<string>();
    const walk = (c: PreloadChunk) => {
      if (seen.has(c.fileName)) return;
      seen.add(c.fileName);
      for (const i of c.imports ?? []) {
        const next = byName.get(i);
        if (next) walk(next);
      }
    };
    walk(start);
    return seen;
  };
  const target = chunks.find((c) =>
    c.facadeModuleId?.replaceAll("\\", "/").endsWith(entry),
  );
  if (!target) return [];
  const already = new Set<string>();
  for (const c of chunks)
    if (c.isEntry) for (const f of closure(c)) already.add(f);
  return [...closure(target)].filter((f) => !already.has(f));
}

export function entryPreloadPlugin(entry = "/src/appMain.tsx"): Plugin {
  let base = "/";
  return {
    name: "k7-entry-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx): HtmlTagDescriptor[] {
        if (!ctx.bundle) return [];
        const bundle = ctx.bundle as unknown as Record<string, PreloadChunk>;
        return preloadFiles(bundle, entry).map((f) => ({
          tag: "link",
          attrs: { rel: "modulepreload", crossorigin: true, href: base + f },
          injectTo: "head",
        }));
      },
    },
  };
}
