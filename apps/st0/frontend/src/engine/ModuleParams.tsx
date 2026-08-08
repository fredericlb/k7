// ModuleParams.tsx — what the engine says a module's plugin actually has. The proof the
// link works, and the list the widget editor's `bind` dropdown will read once the builder
// moves in. An absent engine is shown, not hidden: it explains an empty list.

import { Card } from "@frediverse/ui/card";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Loader2, Plug, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { library } from "../api";
import { useEngine } from "../playback/PlaybackProvider";
import { useEnginePlugins } from "./baseModules";
import { readExtends, resolvePluginBlock } from "./resolvePlugin";

export function ModuleParams({ entry }: { entry: MediatekEntry }) {
  const { phase, client, connected, paramNames, paramMeta, preview, retry } =
    useEngine();
  const scanned = useEnginePlugins(client, connected);
  // What the resolution found, so an empty list can say WHY. Three causes look identical on
  // screen — no engine, a ref this machine has not scanned, a module naming no plugin — and
  // only the first was worded.
  const [plugged, setPlugged] = useState<{
    ref: string;
    found: boolean;
  } | null>(null);

  /**
   * Load the module so the engine can answer for it — through `extends`.
   *
   * A FACE declares nothing but that ref, so reading its own text found no `plugin:` block and
   * every one of those modules reported "le moteur n'a pas encore répondu". It had answered:
   * it was asked to load nothing. See resolvePlugin.ts.
   *
   * `scanned` is a dependency and NOT a precondition. Gating on it would have a machine that
   * has never scanned show nothing for a `jsdsp` module either — one that names its plugin
   * outright and needs no catalogue at all. Arriving late simply re-runs this.
   */
  useEffect(() => {
    if (phase.k !== "ready") return;
    let alive = true;
    void library
      .readFile(`${entry.path}/module.yaml`)
      .then(async (f) => {
        const plugin = await resolvePluginBlock(f.content, scanned, (p) =>
          library.readFile(p).then((m) => m.content),
        );
        if (!alive) return;
        setPlugged({ ref: readExtends(f.content), found: !!plugin });
        preview(entry.name, plugin);
      })
      .catch(() => {
        /* a module with no readable file simply has no parameters to show */
      });
    return () => {
      alive = false;
    };
  }, [entry.path, entry.name, phase.k, scanned, preview]);

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
          : plugged && !plugged.found
            ? // Not "the engine has not answered yet": it answered, and it was asked to load
              // nothing. Naming the ref is what turns an empty list into something to go and fix.
              plugged.ref
              ? `${plugged.ref} : ce moteur n'a pas ce greffon`
              : "ce module ne nomme aucun greffon"
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
