// FileViewer.tsx — one file, read-only, beside a workspace's read-only tree. Nothing here
// writes; a project is edited open.
// See ../../docs/projects.md § A workspace's files.

import { Loader2 } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { TreeSource } from "./workspaceFiles";

type Shown =
  | { kind: "text"; lines: string[] }
  | { kind: "binary" }
  | { kind: "error"; message: string };

/** What to draw for one path: its lines, or a word saying it is binary. */
async function load(source: TreeSource, path: string): Promise<Shown> {
  const f = await source.read(path);
  return f.binary
    ? { kind: "binary" }
    : { kind: "text", lines: f.content.replace(/\n$/, "").split("\n") };
}

function Gutter({ n }: { n?: number }) {
  return (
    <span className="w-10 shrink-0 select-none pr-2 text-right text-faint">
      {n ?? ""}
    </span>
  );
}

export function FileViewer({
  source,
  path,
}: {
  source: TreeSource;
  path: string;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `source.key` is its identity; the object is rebuilt per render.
  useEffect(() => {
    let stop = false;
    setShown(null);
    load(source, path)
      .then((s) => !stop && setShown(s))
      .catch(
        (e: Error) => !stop && setShown({ kind: "error", message: e.message }),
      );
    return () => {
      stop = true;
    };
  }, [source.key, path]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <span className="truncate font-mono">{path}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-5">
        {shown === null ? (
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : shown.kind === "error" ? (
          <div className="p-4 text-destructive">{shown.message}</div>
        ) : shown.kind === "binary" ? (
          <div className="p-4 text-muted-foreground">
            {m["repos.binaryFile"]()}
          </div>
        ) : (
          shown.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's index is its identity in a read-only file.
            <div key={i} className="flex whitespace-pre">
              <Gutter n={i + 1} />
              <span className="pl-2">{l}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
