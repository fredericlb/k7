// SongVariants.tsx — a song's alternative versions, as its sidecar declares them: sibling audio
// files beside the master. The player's tab strip is what auditions one; this is where one goes
// — the tree no longer folds a song open to reach its variants. See packages/mediatek/docs/variants.md.

import { AudioLines, FileQuestion, Trash2 } from "@frediverse/ui/icons";
import type { MediatekEntry } from "@studio/mediatek/types";

export function SongVariants({
  entry,
  onRemove,
}: {
  entry: MediatekEntry;
  /** Absent, the row shows no delete button — read-only. */
  onRemove?: (name: string) => void;
}) {
  const variants = entry.variants ?? [];
  if (!variants.length) return null;

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          Variantes
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {variants.length}
          </span>
        </h3>
      </div>

      <ul className="flex flex-col gap-1">
        {variants.map((v) => (
          <li
            key={v.name}
            className="group flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/40"
          >
            {v.kind === "file" ? (
              <AudioLines className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
            ) : (
              <FileQuestion className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{v.name}</span>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {v.ref}
            </span>
            {/* The sidecar names something the folder has not got, said out loud rather than drawn. */}
            {v.kind === "missing" ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                introuvable
              </span>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(v.name)}
                title={`Supprimer ${v.name}`}
                aria-label={`Supprimer ${v.name}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
