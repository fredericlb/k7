// AssemblyBuilder.tsx — the screen an assembly TEMPLATE is edited on. Its whole job is the one
// thing a template says that a chain does not: which of its members' params are PROMOTED onto the
// box's face. Everything else about the template — its plugs, its wiring — is text, in the pane
// beside the list, because those are two lines each and a form for them would say less.
//
// The param list comes from the template's own GRAPH: an assembly folder is a graph folder, so
// `GET /graph?at=<path>` resolves every member through its `extends` and hands back what it runs
// with. That is the same road the chains builder takes, and it costs no new route.
// Full rationale: docs/builder.md, and packages/song/docs/assemblies.md.

import type { WebGraph } from "@studio/graph-model";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import {
  dropAssemblyParam,
  parseAssemblyTemplate,
  setAssemblyParam,
} from "@studio/song-schema/yaml/assemblyFile";
import { useAutosave } from "@studio/ui-editor/autosave";
import { YamlPane } from "@studio/ui-editor/yaml-pane";
import type { Hints } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuleStore } from "./store";

/** A writer run on the template's text, which comes back edited. */
function edited(text: string, write: (doc: K7Scope) => unknown): string {
  const doc = new K7Document(text);
  write(doc.at([]));
  return doc.toString();
}

/** One promotable row: a member, one of its params, and whether the box already wears it. */
interface Row {
  node: string;
  param: string;
  value: number | string | undefined;
  /** The name it is promoted UNDER, when it is — the template's word, not the plugin's. */
  as?: string;
}

/** Every member's params, in the order the template's own graph puts the members in. */
function rowsOf(
  graph: WebGraph | null,
  promoted: Record<string, { node: string; param: string }>,
): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  const under = new Map(
    Object.entries(promoted).map(([as, t]) => [
      `${t.node}\u0000${t.param}`,
      as,
    ]),
  );
  for (const chain of Object.values(graph?.chains ?? {}))
    for (const step of chain.use) {
      if (seen.has(step.module)) continue;
      seen.add(step.module);
      for (const param of Object.keys(step.params ?? {}).sort())
        out.push({
          node: step.module,
          param,
          value: step.params?.[param],
          as: under.get(`${step.module}\u0000${param}`),
        });
    }
  return out;
}

/** The name a newly promoted param takes: its own, unless the box already wears one by that word. */
function freeName(param: string, taken: Set<string>): string {
  if (!taken.has(param)) return param;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${param} ${n}`)) return `${param} ${n}`;
}

export function AssemblyBuilder({
  path,
  graph,
  store,
  hints,
  vimMode = false,
  readOnly = false,
  onRequestEdit,
  onClose,
}: {
  /** The template's `assembly.k7x`, as the host was GIVEN it — never a path built here. */
  path: string;
  /** The template's own graph, or null while it loads: the members and what each runs with. */
  graph: WebGraph | null;
  store: ModuleStore;
  hints?: Hints;
  vimMode?: boolean;
  /** A library file opens read-only behind a confirmation, exactly as a shared module does. */
  readOnly?: boolean;
  onRequestEdit?: () => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    store.read(path).then(
      (text) => {
        if (!live) return;
        setContent(text ?? "");
        setSaved(text ?? "");
      },
      // Said, and nothing loaded: with no content the autosave has no path, so a blank cannot be written over the file.
      (e: Error) => live && setNote(`could not read ${path}: ${e.message}`),
    );
    return () => {
      live = false;
    };
  }, [store, path]);

  const parsed = useMemo(
    () => (content == null ? null : parseAssemblyTemplate(content)),
    [content],
  );
  const promoted = parsed?.value?.params ?? {};
  const rows = useMemo(() => rowsOf(graph, promoted), [graph, promoted]);

  const autosave = useAutosave({
    path: content == null ? null : path,
    text: content ?? "",
    saved,
    enabled: !readOnly,
    // A library file: a save is a PUBLISH, so it is a button and never a timer — docs/builder.md.
    manual: true,
    write: async (text) => {
      const w = await store.write(path, text);
      setSaved(text);
      if (w.note) setNote(w.note);
    },
  });

  const edit = useCallback((next: string) => {
    setContent(next);
  }, []);

  const toggle = useCallback(
    (row: Row) => {
      if (content == null || readOnly) return;
      if (row.as) {
        const as = row.as;
        edit(edited(content, (doc) => dropAssemblyParam(doc, as)));
        return;
      }
      const name = freeName(row.param, new Set(Object.keys(promoted)));
      edit(
        edited(content, (doc) =>
          setAssemblyParam(doc, name, { node: row.node, param: row.param }),
        ),
      );
    },
    [content, readOnly, promoted, edit],
  );

  const save = useCallback(() => {
    void autosave.flush();
  }, [autosave]);

  // Ctrl+S / :w mean the Save button here, and it saves the file rather than the pane's selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const dirty = content != null && content !== saved;

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <span className="font-medium">{path}</span>
        {readOnly ? (
          <span className="text-muted-foreground text-xs">
            read-only — this template is in the account's library
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {readOnly && onRequestEdit ? (
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              onClick={onRequestEdit}
            >
              Edit…
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            disabled={readOnly || !dirty}
            onClick={save}
          >
            {dirty ? "Save" : "Saved"}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </span>
      </header>

      {note ? (
        <p className="border-b px-4 py-1 text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      {autosave.reason ? (
        <p className="border-b px-4 py-1 text-amber-500 text-xs">
          {autosave.reason}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section className="min-h-0 flex-1 overflow-auto border-r">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground text-xs">
                <th className="px-3 py-1">member</th>
                <th className="px-3 py-1">param</th>
                <th className="px-3 py-1">value</th>
                <th className="px-3 py-1">on the box</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.node}:${r.param}`} className="border-t">
                  <td className="px-3 py-1 text-muted-foreground">{r.node}</td>
                  <td className="px-3 py-1">{r.param}</td>
                  <td className="px-3 py-1 tabular-nums">
                    {String(r.value ?? "")}
                  </td>
                  <td className="px-3 py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!r.as}
                        disabled={readOnly}
                        onChange={() => toggle(r)}
                      />
                      <span className="text-muted-foreground text-xs">
                        {r.as ?? "promote"}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                    {graph
                      ? "this template's members declare no params"
                      : "reading the template's graph…"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="min-h-0 flex-1 overflow-hidden">
          {content == null ? null : (
            <YamlPane
              path={path}
              content={content}
              hints={hints}
              vimMode={vimMode}
              readOnly={readOnly}
              onChange={edit}
              onSave={save}
            />
          )}
        </section>
      </div>
    </div>
  );
}
