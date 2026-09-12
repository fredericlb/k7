// ReferencesPanel.tsx — the workspace's reference tracks, as a panel on the right: what is in
// `_references/`, a ＋ that uploads into it, and a row you click to hear. It plays nothing
// itself — the bar at the bottom of the shell does (../docs/references.md).

import { Button } from "@frediverse/ui/button";
import {
  REFERENCE_ACCEPT,
  REFERENCES_DIR,
  type ReferenceTrack,
} from "@studio/song-schema/reference";
import { Headphones, Loader2, Play, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";

/** A size a reader can hold in their head — the only thing a listing knows before anything decodes. */
function size(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${bytes} B`;
}

export function ReferencesPanel({
  playing,
  onPlay,
  onClose,
}: {
  /** The track the bar has loaded, by path — the row for it reads as the current one. */
  playing: string | null;
  onPlay: (track: ReferenceTrack) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ReferenceTrack[] | null>(null);
  const [error, setError] = useState("");
  /** What the upload is doing, as "file — 40%"; null when nothing is going up. */
  const [busy, setBusy] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setRows((await api.references()).references);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Upload each chosen file into the folder, then re-read: the LISTING is the truth, not what we sent. */
  const upload = async (files: FileList): Promise<void> => {
    setError("");
    for (const file of Array.from(files)) {
      try {
        setBusy(file.name);
        await api.uploadWithProgress(
          REFERENCES_DIR,
          file.name,
          await file.arrayBuffer(),
          (loaded, total) =>
            setBusy(
              `${file.name} — ${Math.round((loaded / Math.max(1, total)) * 100)}%`,
            ),
        );
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    await refresh();
  };

  const remove = async (track: ReferenceTrack): Promise<void> => {
    try {
      // Recycled rather than destroyed, like every other delete on this service.
      await api.deleteFile(track.path);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-border border-l bg-background">
      <header className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
        <Headphones className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm">
          {m["refs.title"]()}
        </span>
        <Button
          size="icon"
          variant="ghost"
          title={m["refs.add"]()}
          aria-label={m["refs.add"]()}
          disabled={busy !== null}
          onClick={() => pick.current?.click()}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* The OS picker, hidden: `accept` is the same extension list the listing goes by. */}
      <input
        ref={pick}
        type="file"
        multiple
        accept={REFERENCE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files?.length) void upload(files);
          e.currentTarget.value = "";
        }}
      />

      {busy ? (
        <p className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-1.5 text-muted-foreground text-xs">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> {busy}
        </p>
      ) : null}

      {error ? (
        <p className="shrink-0 border-b px-2 py-1.5 text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> {m["common.loading"]()}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-muted-foreground text-sm">
            {parts((h) => m["refs.empty"](h), {
              dir: <span className="font-mono">{REFERENCES_DIR}/</span>,
            })}
          </p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.path} className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => onPlay(r)}
                  title={r.path}
                  aria-current={playing === r.path}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent ${
                    playing === r.path ? "text-foreground" : ""
                  }`}
                >
                  <Play
                    className={`h-3 w-3 shrink-0 ${playing === r.path ? "text-foreground" : "text-muted-foreground"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {size(r.bytes)}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  title={m["refs.remove"]()}
                  aria-label={m["refs.remove"]()}
                  onClick={() => void remove(r)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
