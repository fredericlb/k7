// Session.tsx — what the v2 editor does today: it SHOWS the session. One list of the project's
// YAML files and the text of the one you pick, read through the same file service l8 and m9
// read a project through.
//
// Deliberately read-only, and deliberately the raw file. The session format is young (see
// apps/z0/docs/projects.md) and the first thing worth having is a way to look at what is
// actually on disk — before any form gets built over it and starts hiding it.

import { Button } from "@frediverse/ui/button";
import type { FileNode } from "@studio/web-protocol";
import { FileText, Loader2, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";

/** Every text file in the tree, depth-first — the order the folders are walked in. */
function flatten(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((n) =>
    n.dir ? flatten(n.children ?? []) : n.kind === "binary" ? [] : [n],
  );
}

/** `session.yaml` first when it is there: it is the one file that names the whole session. */
function ordered(files: FileNode[]): FileNode[] {
  const head = files.filter((f) => f.name === "session.yaml");
  return [...head, ...files.filter((f) => !head.includes(f))];
}

export function Session({
  project,
  quit,
}: {
  project: string;
  quit: () => void;
}) {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .tree()
      .then((nodes) => {
        const list = ordered(flatten(nodes));
        setFiles(list);
        setSelected(list[0]?.path ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setText(null);
    void api
      .read(selected)
      .then((f) => setText(f.content))
      .catch((e: Error) => setError(e.message));
  }, [selected]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-sm font-semibold">{project}</span>
        <span className="text-xs text-muted-foreground">
          {files ? `${files.length} fichier(s)` : "…"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-xs"
          onClick={quit}
        >
          <LogOut className="mr-1 h-3 w-3" />
          Projets
        </Button>
      </header>

      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="w-72 shrink-0 overflow-y-auto border-r py-1">
          {files === null && (
            <div className="flex justify-center p-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {files?.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelected(f.path)}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${
                f.path === selected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
            >
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate" title={f.path}>
                {f.path}
              </span>
            </button>
          ))}
          {files?.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Ce dossier .z0 ne contient aucun fichier texte.
            </p>
          )}
        </nav>

        <main className="min-w-0 flex-1 overflow-auto">
          {text === null ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            // `pre` and not an editor: this shows the file, byte for byte, including the
            // comments the generator wrote. An editor would be the next step, not this one.
            <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre">
              {text}
            </pre>
          )}
        </main>
      </div>
    </div>
  );
}
