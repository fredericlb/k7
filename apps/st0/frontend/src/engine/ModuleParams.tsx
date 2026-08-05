// ModuleParams.tsx — what the engine says a module's plugin actually has. The proof the
// link works, and the list the widget editor's `bind` dropdown will read once the builder
// moves in. An absent engine is shown, not hidden: it explains an empty list.

import { Card } from "@frediverse/ui/card";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Loader2, Plug, PlugZap } from "lucide-react";
import { useEffect } from "react";
import { library } from "../api";
import { useEngine } from "../playback/PlaybackProvider";
import { readPluginBlock } from "./preview";

export function ModuleParams({ entry }: { entry: MediatekEntry }) {
  const { phase, paramNames, paramMeta, preview, retry } = useEngine();

  useEffect(() => {
    if (phase.k !== "ready") return;
    let alive = true;
    void library
      .readFile(`${entry.path}/module.yaml`)
      .then((f) => alive && preview(entry.name, readPluginBlock(f.content)))
      .catch(() => {
        /* a module with no readable file simply has no parameters to show */
      });
    return () => {
      alive = false;
    };
  }, [entry.path, entry.name, phase.k, preview]);

  if (phase.k === "looking")
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        recherche d'un moteur sur cette machine…
      </Card>
    );

  if (phase.k === "absent")
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Plug className="h-4 w-4" />
        Aucun moteur sur cette machine — lance le capot pour voir les paramètres
        de ce module.
        <button type="button" className="ml-2 underline" onClick={retry}>
          réessayer
        </button>
      </Card>
    );

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <PlugZap className="h-4 w-4" />
        {paramNames.length
          ? `${paramNames.length} paramètre(s)`
          : "le moteur n'a pas encore répondu pour ce module"}
      </div>
      <ul className="flex flex-col gap-0.5 font-mono text-xs">
        {paramNames.map((n) => {
          const m = paramMeta[n];
          return (
            <li key={n} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate">{n}</span>
              {m ? (
                <span className="text-muted-foreground">
                  {m.min} … {m.max}
                  {m.states ? ` (${m.states.length} positions)` : ""}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
