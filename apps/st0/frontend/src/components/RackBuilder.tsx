// RackBuilder.tsx — build a SAMPLES rack on a 4×4 pad grid: drop audio files on the pads,
// click one to hear it, name each pad (the rack's symbols) and the rack itself, then CREATE —
// which uploads the samples beside a fresh module.yaml and writes the module
// (modules/instruments/<name>/, the layout every rack in a real song already loads). Notes run
// 36 upward, bottom-left first — the drum-machine reading rackBuilder.ts pins. Opened by the
// `module create rack` palette command; samples only, the slice flavour has its own editor.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { showToast } from "@studio/project-shell/toast";
import { Loader2, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  buildRackModuleYaml,
  cellsInNoteOrder,
  defaultSymbol,
  GRID,
  padNote,
  type RackPad,
  rackIssues,
} from "../rackBuilder";

interface Pad {
  file: File;
  url: string; // object URL, revoked with the pad
  symbol: string;
}

export function RackBuilder({
  activeProject,
  onClose,
  onCreated,
}: {
  /** The active project's folder, '.' for a lone one — the api speaks WORKSPACE-relative, so every write must carry this prefix. */
  activeProject: string | null;
  onClose: () => void;
  /** The module landed — `instruments/<name>` — so the shell can reload and say so. */
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  // row-major, row 0 at the top — the render order; the NOTE order is rackBuilder's business.
  const [pads, setPads] = useState<(Pad | null)[]>(
    Array.from({ length: GRID * GRID }, () => null),
  );
  const [busy, setBusy] = useState(false);
  // The base-module refs already taken, so "it exists" is said before any upload runs.
  const [taken, setTaken] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .hints()
      .then((h) => !cancelled && setTaken(h.baseModules))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ONE audition element: clicking a pad replaces what is playing, and closing revokes every URL.
  const audio = useRef<HTMLAudioElement | null>(null);
  const padsRef = useRef(pads);
  padsRef.current = pads;
  useEffect(
    () => () => {
      audio.current?.pause();
      for (const p of padsRef.current) if (p) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const play = (pad: Pad) => {
    audio.current?.pause();
    audio.current = new Audio(pad.url);
    void audio.current.play().catch(() => {});
  };

  /** Empty one pad: the object URL goes with it, or a builder filled and cleared a few times leaks every sample it has seen. */
  const clearPad = (row: number, col: number) => {
    setPads((prev) => {
      const at = row * GRID + col;
      const old = prev[at];
      if (!old) return prev;
      if (audio.current && audio.current.src === old.url) audio.current.pause();
      URL.revokeObjectURL(old.url);
      const next = [...prev];
      next[at] = null;
      return next;
    });
  };

  /** Drop N files on a cell: the first lands THERE and the rest fill onward in NOTE order — the order the rack will play. */
  const drop = (row: number, col: number, files: FileList) => {
    const order = cellsInNoteOrder();
    const from = order.findIndex((c) => c.row === row && c.col === col);
    const audioFiles = [...files].filter((f) =>
      /\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i.test(f.name),
    );
    if (!audioFiles.length) return;
    setPads((prev) => {
      const next = [...prev];
      let i = from;
      for (const f of audioFiles) {
        if (i >= order.length) break;
        const at = order[i].row * GRID + order[i].col;
        const old = next[at];
        if (old) URL.revokeObjectURL(old.url);
        next[at] = {
          file: f,
          url: URL.createObjectURL(f),
          symbol: defaultSymbol(f.name),
        };
        i++;
      }
      return next;
    });
  };

  // The pads as the module will hold them — note order, bottom-left first.
  const rackPads = useMemo<(RackPad & { pad: Pad })[]>(
    () =>
      cellsInNoteOrder()
        .map(({ row, col }) => ({ row, col, pad: pads[row * GRID + col] }))
        .filter((c): c is typeof c & { pad: Pad } => c.pad != null)
        .map(({ row, col, pad }) => ({
          symbol: pad.symbol,
          fileName: pad.file.name,
          note: padNote(row, col),
          pad,
        })),
    [pads],
  );
  const issues = rackIssues(name.trim(), rackPads, taken);

  const create = async () => {
    if (busy || issues.length) return;
    setBusy(true);
    // WORKSPACE-relative, project prefix included: without it the module lands BESIDE the project, where nothing ever lists it.
    const ap = (activeProject ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    const prefix = ap && ap !== "." ? `${ap}/` : "";
    const dir = `${prefix}modules/instruments/${name.trim()}`;
    try {
      // The samples first, then the module that names them: a reload between the two finds files nothing reads, never a module with no clips.
      for (const p of rackPads)
        await api.upload(dir, p.fileName, await p.pad.file.arrayBuffer());
      await api.write(
        `${dir}/module.yaml`,
        buildRackModuleYaml(name.trim(), rackPads),
      );
      onCreated(`instruments/${name.trim()}`);
    } catch (e) {
      showToast({
        message: `rack : ${(e as Error).message}`,
        variant: "error",
      });
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* The backdrop closes, like every popin's. */}
      <button
        type="button"
        aria-label="fermer"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-[min(34rem,92vw)] flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary">⣿ nouveau rack</span>
          <span className="text-xs text-muted-foreground">
            glisser des samples sur les pads · cliquer écoute · les noms
            deviennent les symboles
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            onClick={onClose}
            aria-label="fermer"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          nom
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="drum_3"
            className="w-48 rounded border border-border bg-card px-2 py-1 font-mono text-sm"
          />
          <span className="truncate text-xs text-muted-foreground">
            → modules/instruments/{name.trim() || "…"}
          </span>
        </label>

        {/* The grid, rendered top row first, while the NOTES read the other way (36 bottom-left) — hence each pad saying its own. */}
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: GRID }).flatMap((_, row) =>
            Array.from({ length: GRID }).map((_, col) => {
              const pad = pads[row * GRID + col];
              return (
                <div
                  key={`${row}:${col}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(row, col, e.dataTransfer.files);
                  }}
                  className={cn(
                    "flex h-24 flex-col rounded-md border p-1.5",
                    pad
                      ? "border-emerald-500/60 bg-emerald-500/10"
                      : "border-dashed border-border bg-card/40",
                  )}
                >
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="tabular-nums">{padNote(row, col)}</span>
                    {pad && (
                      <>
                        <button
                          type="button"
                          title={`écouter ${pad.file.name}`}
                          onClick={() => play(pad)}
                          className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                        {/* Emptying a pad, beside the button that plays it, red on hover only (docs/shell.md). */}
                        <button
                          type="button"
                          title={`enlever ${pad.file.name} du pad`}
                          aria-label="enlever ce sample"
                          onClick={() => clearPad(row, col)}
                          className="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                  {pad ? (
                    <>
                      <input
                        value={pad.symbol}
                        onChange={(e) =>
                          setPads((prev) => {
                            const next = [...prev];
                            next[row * GRID + col] = {
                              ...pad,
                              symbol: e.target.value,
                            };
                            return next;
                          })
                        }
                        className="mt-1 w-full rounded border border-transparent bg-transparent font-mono text-xs font-semibold focus:border-border"
                        aria-label="symbole du pad"
                      />
                      <span
                        className="mt-auto truncate text-[10px] text-muted-foreground"
                        title={pad.file.name}
                      >
                        {pad.file.name}
                      </span>
                    </>
                  ) : (
                    <span className="m-auto text-[10px] text-muted-foreground/60">
                      déposer un sample
                    </span>
                  )}
                </div>
              );
            }),
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* What blocks the CREATE, said in place rather than on a dead button. */}
          <span className="min-w-0 flex-1 truncate text-xs text-amber-400">
            {issues[0] ?? ""}
          </span>
          <Button
            size="sm"
            disabled={busy || issues.length > 0}
            onClick={() => void create()}
          >
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            créer
          </Button>
        </div>
      </div>
    </div>
  );
}
