// ModuleSidePane.tsx — the MODULE behind the instance the popin shows: a node's file names its
// per-instance fields, and what those override lives one `extends:` away, so the two are read —
// and edited — side by side. A small self-contained editor (its own buffer, its own autosave),
// because the popin's main pane is THE editor instance and its undo history must stay its own.

import { showToast } from "@studio/project-shell/toast";
import { useAutosave } from "@studio/ui-editor/autosave";
import type { FileContent, Hints } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { rackKeyOf } from "../projectPaths";
import { rackSliceRanges, setSliceWindow } from "../sliceSymbols";
import type { PreviewReq, WebClip, WebProject } from "../types";
import { EditorPane } from "./EditorPane";

export function ModuleSidePane({
  path,
  refName,
  hints,
  vimMode,
  setStatus,
  onChanged,
}: {
  /** The module's file — resolved from the instance's `extends:` (see moduleBehind.ts). */
  path: string;
  /** The ref as the instance wrote it — what the header names; the path is the resolver's. */
  refName: string;
  hints: Hints;
  vimMode: boolean;
  setStatus: (s: string) => void;
  /** The graph and the arrangement may change under a module edit, exactly as under the main pane's. */
  onChanged: () => void;
}) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    api
      .read(path)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setSaved(f.binary ? "" : f.content);
      })
      .catch((e) => !cancelled && setStatus(`module: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [path, setStatus]);

  const autosave = useAutosave({
    path: file && !file.binary ? file.path : null,
    text: file?.content ?? "",
    saved,
    write: async (text) => {
      const p = file?.path;
      if (!p) return;
      // The same fork rule the main editor's write follows: a shared `_modules` file is not
      // written, a project copy is — and this pane moves onto the copy, which now holds the edit.
      const { forked } = await api.write(p, text);
      setSaved(text);
      if (forked) {
        setFile({ path: forked.path, binary: false, content: text });
        setStatus(
          `${forked.ref} is shared — saved a project copy as ${forked.module}`,
        );
      } else setStatus(`saved ${p}`);
      onChanged();
    },
  });
  useEffect(() => {
    if (autosave.status === "error" && autosave.reason)
      setStatus(`save error: ${autosave.reason}`);
  }, [autosave.status, autosave.reason, setStatus]);

  /**
   * The gutter ▶s, auditioning through the engine — the same buttons the main editor puts on
   * every source/clip/slice line. A rack's source names a file BESIDE the module file, so a
   * bare name resolves against this pane's own folder — spelled PROJECT-RELATIVE when the
   * project root is known, so the request is byte-identical to the one the full-screen editor
   * sends for the same line; the route accepts the absolute fallback too.
   *
   * A failure TOASTS: the shell's status line sits under the popin, so an error written only
   * there was an error nobody saw — which is how "no sound" stayed unexplained.
   */
  const onPreview = useCallback(
    (req: PreviewReq) => {
      const norm = (file?.path ?? path).replace(/\\/g, "/");
      const root = hints.projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
      const rel =
        root && norm.startsWith(`${root}/`)
          ? norm.slice(root.length + 1)
          : norm;
      const dir = rel.replace(/\/[^/]*$/, "");
      const r =
        req.kind === "clip" || /^([A-Za-z]:[\\/]|[\\/])/.test(req.source)
          ? req
          : { ...req, source: `${dir}/${req.source}` };
      void api.preview(r).catch((e) => {
        setStatus(`preview error: ${(e as Error).message}`);
        showToast({
          message: `preview : ${(e as Error).message}`,
          variant: "error",
        });
      });
    },
    [file?.path, path, hints.projectRoot, setStatus],
  );

  // This pane's own bottom widgets, the ones the main editor would give the same file: a
  // SLICE-rack module docks its source waveform with every symbol's window in its own colour —
  // the slicer. The racks hint carries the source ABSOLUTE, so the pane needs no path
  // arithmetic of its own; the project doc rides along for the strip's tempo grid.
  const rack = useMemo(() => {
    const key = rackKeyOf(file?.path ?? path);
    const rk = key ? hints.racks[key] : undefined;
    return rk?.rackType === "slice" && rk.source ? rk : null;
  }, [file?.path, path, hints]);
  const [audioClip, setAudioClip] = useState<{
    project: WebProject;
    clip: WebClip;
    sliceRanges: { symbol: string; from: number; to: number; color?: string }[];
  } | null>(null);
  useEffect(() => {
    if (!rack?.source) return void setAudioClip(null);
    const source = rack.source;
    let cancelled = false;
    void api
      .projectDoc()
      .then((proj) => {
        if (cancelled) return;
        setAudioClip({
          project: proj,
          clip: {
            id: source,
            type: "audio",
            name: source,
            start: 0,
            length: 0,
            notes: [],
          },
          sliceRanges: rackSliceRanges(rack.symbols),
        });
      })
      .catch(() => !cancelled && setAudioClip(null));
    return () => {
      cancelled = true;
    };
  }, [rack]);

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-border">
      <div
        className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs"
        title="le fichier du module — un enregistrement vaut pour toutes ses instances"
      >
        <span className="font-semibold text-primary">module</span>
        <span className="truncate text-foreground">{refName}</span>
        <span className="ml-auto truncate text-muted-foreground/70">
          {file?.path ?? path}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <EditorPane
          file={file}
          hints={hints}
          vimMode={vimMode}
          audioClip={audioClip}
          onPreview={onPreview}
          // The slicer's drag rewrites this pane's OWN buffer — the module file is exactly
          // where the symbols live — and flows through its autosave like a keystroke.
          onSliceEdit={(symbol, from, to) => {
            if (!file || file.binary) return;
            const next = setSliceWindow(file.content, symbol, from, to);
            if (next != null) setFile({ ...file, content: next });
          }}
          onChange={(v) => file && setFile({ ...file, content: v })}
          onSave={autosave.flush}
        />
      </div>
    </div>
  );
}
