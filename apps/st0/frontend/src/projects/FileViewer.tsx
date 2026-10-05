// FileViewer.tsx — one file, read-only, beside the read-only tree (a workspace's, or a library's in
// the editor's "show diff"): its content when it is committed, its diff against HEAD when it is
// not. Nothing here writes; a project is edited open.
// See ../../docs/projects.md § A workspace's files.

import { Loader2 } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { allAdded, type DiffRow, parseUnifiedDiff } from "./unifiedDiff";
import type { TreeSource } from "./workspaceFiles";

type Shown =
  | { kind: "text"; lines: string[] }
  | { kind: "diff"; rows: DiffRow[] }
  | { kind: "binary" }
  | { kind: "error"; message: string };

/** What to draw for one path: a change is diffed, an untracked file is all added. */
async function load(
  source: TreeSource,
  path: string,
  code: string | undefined,
): Promise<Shown> {
  const read = () => source.read(path);
  if (!code) {
    const f = await read();
    return f.binary
      ? { kind: "binary" }
      : { kind: "text", lines: f.content.replace(/\n$/, "").split("\n") };
  }
  const diff = code === "??" ? "" : await source.diff(path);
  if (diff) return { kind: "diff", rows: parseUnifiedDiff(diff) };
  // Untracked, or added on a branch with no commit yet: no earlier version to compare with.
  const f = await read();
  return f.binary
    ? { kind: "binary" }
    : { kind: "diff", rows: allAdded(f.content) };
}

const ROW_TONE: Record<DiffRow["kind"], string> = {
  add: "bg-emerald-500/15",
  del: "bg-rose-500/15",
  ctx: "",
  hunk: "bg-sky-500/10 text-sky-500",
  note: "text-muted-foreground italic",
};
const MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  del: "-",
  ctx: " ",
  hunk: "",
  note: "",
};

function Gutter({ n }: { n?: number }) {
  return (
    <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">
      {n ?? ""}
    </span>
  );
}

export function FileViewer({
  source,
  path,
  code,
}: {
  source: TreeSource;
  path: string;
  /** git's status letters when the path is not committed. */
  code: string | undefined;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `source.key` is its identity; the object is rebuilt per render.
  useEffect(() => {
    let stop = false;
    setShown(null);
    load(source, path, code)
      .then((s) => !stop && setShown(s))
      .catch(
        (e: Error) => !stop && setShown({ kind: "error", message: e.message }),
      );
    return () => {
      stop = true;
    };
  }, [source.key, path, code]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <span className={`truncate font-mono ${code ? "text-sky-500" : ""}`}>
          {path}
        </span>
        {code && (
          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 font-mono text-xs text-sky-500">
            {code.trim()}
          </span>
        )}
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
        ) : shown.kind === "text" ? (
          shown.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's index is its identity in a read-only file.
            <div key={i} className="flex whitespace-pre">
              <Gutter n={i + 1} />
              <span className="pl-2">{l}</span>
            </div>
          ))
        ) : shown.rows.length === 0 ? (
          <div className="p-4 text-muted-foreground">{m["repos.noDiff"]()}</div>
        ) : (
          shown.rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows of a diff that is replaced whole, never reordered.
            <div key={i} className={`flex whitespace-pre ${ROW_TONE[r.kind]}`}>
              {r.kind === "hunk" || r.kind === "note" ? (
                <span className="pl-2">{r.text}</span>
              ) : (
                <>
                  <Gutter n={r.old} />
                  <Gutter n={r.new} />
                  <span className="w-4 shrink-0 select-none text-center">
                    {MARK[r.kind]}
                  </span>
                  <span>{r.text}</span>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
