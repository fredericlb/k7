// SongVariants.tsx — a song's alternative versions, as its sidecar declares them: sibling audio
// files beside the master. A LIST and nothing more — the player's tab strip is what auditions
// one. See packages/mediatek/docs/variants.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { AudioLines, FileQuestion } from "lucide-react";

export function SongVariants({ entry }: { entry: MediatekEntry }) {
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
            className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/40"
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
          </li>
        ))}
      </ul>
    </section>
  );
}
