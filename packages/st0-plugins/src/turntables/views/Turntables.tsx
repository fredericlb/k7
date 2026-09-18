// Turntables.tsx — the desk AS A SURFACE: what a host mounts for `type: turntables`. It checks
// the mapping first and draws the missing wiring instead of a desk whose knobs go nowhere.
// See packages/song/docs/surfaces.md and ../../docs/hosting.md.

import type { MixView as Mapping } from "@studio/song-schema/yaml/mixViewSchema";
import { Unplug } from "lucide-react";
import type { Deck } from "../engine";
import { unmappedControls } from "../mapping";
import type { DeckSet } from "../useDeckSet";
import { MixView } from "./MixView";

/** The desk, or the reason it cannot be drawn — a GATE, since these components make a desk a desk. */
export function Turntables({
  engine,
  deck,
  set,
  mapping,
  /** Which playlist the surface names — carried through, `useDeckSet` has already read the file. */
  playlist,
  /** Whether this desk separates a record handed to it unprepared — see MixView's `stems`. */
  stems,
  /** The surface's own file, so the message can name what to edit. */
  file,
  library,
}: {
  engine: { fileBase: string | null; id: string };
  /** pl8's API base, for the one thing the library owns — separating a record. See MixView's `library`. */
  library?: { base: string };
  deck: Deck;
  set: DeckSet;
  mapping: Mapping | undefined;
  playlist?: string;
  stems?: boolean;
  file: string;
}) {
  const missing = unmappedControls(mapping);
  if (missing.length)
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
        <Unplug className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <ul className="flex max-w-xl flex-col gap-1.5">
          {missing.map((c) => (
            <li
              key={c.id}
              className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              Le composant {c.id} de cette vue n'est pas mappé à un module
            </li>
          ))}
        </ul>
        {/* The fix, not just the fault: a line somebody can copy, in the file it goes in. */}
        <p className="max-w-xl text-center text-xs text-muted-foreground">
          Add them under <code>mapping:</code> in <code>{file}</code> — one line
          per component, <code>{"{ module: …, param: … }"}</code>, where{" "}
          <code>module</code> is the name <code>chains.yaml</code> gives it.
        </p>
      </div>
    );

  return (
    <MixView
      engine={engine}
      library={library}
      deck={deck}
      set={set}
      playlist={playlist}
      stems={stems}
      file={file}
    />
  );
}
