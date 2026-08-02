// ModulesPage.tsx — the module builder's front door: the workspace's shared `_modules`,
// grouped by type folder. Picking one opens its builder on the catalogue's own file.
//
// A settings screen and no longer a click in the graph, because a module is a WORKSPACE
// thing: the same file backs every project beside it, so editing it from inside one song
// only ever looked like a per-project edit. Instances are counted, not listed — they share
// their generic's face, and a `ui:` written on one is ignored by the loader.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  LayoutGrid,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { CatalogueModule } from "../types";

/** The catalogue's type folders, in the order a signal runs through them; the rest follow, sorted. */
const ORDER = ["io", "instruments", "midi", "audio", "transformers"];
const rank = (c: string) => {
  const i = ORDER.indexOf(c);
  return i < 0 ? ORDER.length : i;
};

function ModuleRow({
  mod,
  onPick,
}: {
  mod: CatalogueModule;
  onPick: (mod: CatalogueModule) => void;
}) {
  // The type folder is the group's own heading — repeating it on every row of the group is noise.
  const label = mod.name.startsWith(`${mod.category}/`)
    ? mod.name.slice(mod.category.length + 1)
    : mod.name;
  return (
    <button
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
      onClick={() => onPick(mod)}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-xs">
        {label}
        <span className="ml-1.5 text-[10px] text-muted-foreground">
          @{mod.namespace}
        </span>
      </span>
      {mod.instances > 0 && (
        <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
          {m["modules.instances"]({ n: String(mod.instances) })}
        </span>
      )}
      {mod.plugin && (
        <span className="shrink-0 truncate text-[10px] text-muted-foreground">
          {mod.plugin}
        </span>
      )}
      {/* A module with a panel already drawn — the one thing the builder is mostly opened for. */}
      {mod.hasUi && (
        <LayoutGrid className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function ModulesPage({
  onPick,
  onBack,
  reloadKey,
}: {
  onPick: (mod: CatalogueModule) => void;
  onBack: () => void;
  // Bumped when a save lands, so a new panel's marker shows without reopening the screen.
  reloadKey: number;
}) {
  const [mods, setMods] = useState<CatalogueModule[] | null>(null);
  // A populated catalogue is hundreds of modules — one per scanned plugin — so the filter isn't a
  // convenience here, it is how the list is read at all.
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .moduleCatalogue()
      .then((c) => alive && setMods(c))
      .catch(() => alive && setMods([]));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Matched on the ref AND the plugin name: people look for "Neural Amp Modeler" as often as for `nam`.
  const needle = q.trim().toLowerCase();
  const groups = new Map<string, CatalogueModule[]>();
  for (const mod of mods ?? []) {
    if (
      needle &&
      !mod.ref.toLowerCase().includes(needle) &&
      !(mod.plugin ?? "").toLowerCase().includes(needle)
    )
      continue;
    const g = groups.get(mod.category);
    if (g) g.push(mod);
    else groups.set(mod.category, [mod]);
  }
  const categories = [...groups.keys()].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="h-5 w-5" /> {m["settings.modules"]()}
          </h1>
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> {m["sshKey.back"]()}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{m["modules.hint"]()}</p>

        {!!mods?.length && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={m["modules.filter"]()}
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}

        {mods === null ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            …
          </div>
        ) : mods.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-xs text-muted-foreground">
            {m["modules.empty"]()}
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-xs text-muted-foreground">
            {m["modules.noMatch"]()}
          </div>
        ) : (
          categories.map((c) => (
            <div
              key={c}
              className="overflow-hidden rounded-md border border-border"
            >
              <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {c}
              </div>
              <div className="divide-y divide-border/50">
                {groups.get(c)!.map((mod) => (
                  <ModuleRow key={mod.ref} mod={mod} onPick={onPick} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
