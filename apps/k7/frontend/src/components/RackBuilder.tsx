// RackBuilder.tsx — build a KIT on a 4×4 pad grid: drop audio files on the pads, click one to hear
// it, name each pad (its tap) and the kit, choose where the samples go — this project's samples/
// or a library's — then CREATE: the samples are uploaded there, and the kit becomes a NODE of the
// library's `k7-rack` on its `samples` engine, placed with its taps. Notes run 36 upward, bottom-left first —
// the drum-machine reading rackBuilder.ts pins. Opened by `module create rack` (packages/song/docs/racks.md).

import { Button } from "@frediverse/ui/button";
import { Grip, Loader2, Pause, Play, X } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { showToast } from "@studio/project-shell/toast";
import { FIXED_NAMESPACES } from "@studio/song-schema/moduleTypes";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { projectDir } from "../projectPaths";
import {
  buildKitNode,
  cellsInNoteOrder,
  defaultSymbol,
  GRID,
  type KitDestination,
  kitSampleRef,
  kitUploadDir,
  padNote,
  type RackPad,
  rackIssues,
  rackModuleRef,
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
  /** The kit landed — the NODE's name — so the shell can reload and say so. */
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  // row-major, row 0 at the top — the render order; the NOTE order is rackBuilder's business.
  const [pads, setPads] = useState<(Pad | null)[]>(
    Array.from({ length: GRID * GRID }, () => null),
  );
  const [busy, setBusy] = useState(false);
  // Which file of how many, and how far into it — a rack is up to sixteen uploads and a disabled button says none of that.
  const [up, setUp] = useState<{
    done: number;
    total: number;
    name: string;
    frac: number;
  } | null>(null);
  // The project's node names, so "it exists" is said before any upload runs — and which library's sampler a kit extends.
  const [taken, setTaken] = useState<string[]>([]);
  const [rackRef, setRackRef] = useState<string | null>(null);
  // The account's libraries, the other places a kit's samples can go.
  const [libraries, setLibraries] = useState<string[]>([]);
  const [dest, setDest] = useState<KitDestination>("project");
  useEffect(() => {
    let cancelled = false;
    void api
      .hints()
      .then((h) => {
        if (cancelled) return;
        setTaken(h.modules);
        setRackRef(rackModuleRef(h.baseModules));
      })
      .catch(() => {});
    void api
      .moduleLibraries()
      .then(
        ({ libraries: l }) =>
          !cancelled &&
          setLibraries(
            l
              .map((x) => x.ns)
              .filter(
                (ns) => !(FIXED_NAMESPACES as readonly string[]).includes(ns),
              ),
          ),
      )
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

  // The pad sounding now, so its own button reads Pause; cleared when the sample stops for any reason.
  const [sounding, setSounding] = useState<string | null>(null);
  const play = (pad: Pad) => {
    audio.current?.pause();
    const a = new Audio(pad.url);
    audio.current = a;
    const done = () => setSounding((cur) => (cur === pad.url ? null : cur));
    a.addEventListener("ended", done);
    a.addEventListener("pause", done);
    setSounding(pad.url);
    void a.play().catch(done);
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
  const issues = rackIssues(name.trim(), rackPads, taken, !!rackRef);

  const create = async () => {
    if (busy || issues.length || !rackRef) return;
    setBusy(true);
    const kit = name.trim();
    // WORKSPACE-relative, project prefix included: without it a file lands BESIDE the project, where nothing ever lists it.
    const ap = projectDir(activeProject);
    const prefix = ap ? `${ap}/` : "";
    // The samples go where every sample lives: a samples/ folder, the project's own or a library's.
    const src = kitUploadDir(dest, kit, ap);
    let done = 0;
    try {
      // The samples first, then the module that names them: a reload between the two finds files nothing reads, never a module with no clips.
      for (const p of rackPads) {
        setUp({ done, total: rackPads.length, name: p.fileName, frac: 0 });
        await api.uploadWithProgress(
          src,
          p.fileName,
          p.pad.file,
          (loaded, total) =>
            setUp({
              done,
              total: rackPads.length,
              name: p.fileName,
              frac: total ? loaded / total : 0,
            }),
        );
        done++;
      }
      setUp({ done, total: rackPads.length, name: `${kit}.k7x`, frac: 0 });
      // The node, IN the graph and wired to nothing, straight over the library's sampler — the verb that does both, and journals it.
      const made = await api.command(`node new ${rackRef} ${kit}`, {
        want: [],
      });
      if (made.refused) throw new Error(made.output.join(" · "));
      // A chain project names the node by a uuid, inside a chain file: the one name that just appeared (packages/song/docs/chainFiles.md).
      const fresh = (await api.hints()).modules.filter(
        (n) => !taken.includes(n),
      );
      const inChain = fresh.length === 1 && fresh[0] !== kit ? fresh[0] : null;
      if (inChain) {
        // …so its taps go through the verbs that know where that node lives, a note then a sample each.
        for (const p of rackPads) {
          const sample = kitSampleRef(dest, kit, p.fileName);
          for (const line of [
            `node tap note ${inChain} ${p.symbol} ${p.note}`,
            `node tap sample ${inChain} ${p.symbol} ${JSON.stringify(sample)}`,
          ]) {
            const r = await api.command(line, { want: [] });
            if (r.refused) throw new Error(r.output.join(" · "));
          }
        }
      } else {
        // …else its taps, in one write rather than a reload per pad.
        await api.write(
          `${prefix}nodes/${kit}.k7x`,
          buildKitNode(kit, rackPads, dest, rackRef),
        );
      }
      onCreated(kit);
    } catch (e) {
      // Which file, and what the earlier ones left behind — the samples land before the module by design.
      const landed = done
        ? ` — ${done} of ${rackPads.length} sample(s) are already in ${src}`
        : "";
      showToast({
        message: `rack : ${(e as Error).message}${landed}`,
        variant: "error",
      });
      setUp(null);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* The backdrop closes, like every popin's. */}
      <button
        type="button"
        aria-label={m["common.closeLower"]()}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-[min(34rem,92vw)] flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary-text">
            <Grip className="h-4 w-4" /> {m["rb.title"]()}
          </span>
          <span className="text-xs text-muted-foreground">
            {m["rb.hint"]()}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            onClick={onClose}
            aria-label={m["common.closeLower"]()}
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
            → nodes/{name.trim() || "…"}
          </span>
        </label>

        {/* Where the SAMPLES go — this song alone, or a library every song can pick from. */}
        <label className="flex items-center gap-2 text-sm">
          {m["rb.samplesTo"]()}
          <select
            value={dest === "project" ? "" : dest.library}
            onChange={(e) =>
              setDest(e.target.value ? { library: e.target.value } : "project")
            }
            className="rounded border border-border bg-card px-2 py-1 text-sm"
          >
            <option value="">{m["rb.toProject"]()}</option>
            {libraries.map((l) => (
              <option key={l} value={l}>
                @{l}
              </option>
            ))}
          </select>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {kitUploadDir(dest, name.trim() || "…", activeProject ?? "")}
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
                          title={
                            sounding === pad.url
                              ? "Pause"
                              : m["rb.listen"]({ name: pad.file.name })
                          }
                          onClick={() =>
                            sounding === pad.url
                              ? audio.current?.pause()
                              : play(pad)
                          }
                          className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground"
                        >
                          {sounding === pad.url ? (
                            <Pause className="h-3 w-3" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                        </button>
                        {/* Emptying a pad, beside the button that plays it, red on hover only (docs/shell.md). */}
                        <button
                          type="button"
                          title={m["rb.clearPad"]({ name: pad.file.name })}
                          aria-label={m["rb.clearPad"]({ name: pad.file.name })}
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
                        aria-label={m["rb.padSymbol"]()}
                      />
                      <span
                        className="mt-auto truncate text-[10px] text-muted-foreground"
                        title={pad.file.name}
                      >
                        {pad.file.name}
                      </span>
                    </>
                  ) : (
                    <span className="m-auto text-[10px] text-faint">
                      {m["rb.dropSample"]()}
                    </span>
                  )}
                </div>
              );
            }),
          )}
        </div>

        {/* Sixteen uploads deserve a count: which file, how far in, and how many are already on disk. */}
        {up && (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
              <span className="truncate">{up.name}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {Math.min(up.done + 1, up.total)}/{up.total}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round(((up.done + up.frac) / up.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

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
            {m["rb.create"]()}
          </Button>
        </div>
      </div>
    </div>
  );
}
