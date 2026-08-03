// Library.tsx — the catalogue, read-only: the three families down the side, their entries
// in the middle. Refetches a family only when ITS revision moved, which is the whole
// reason the service hands out one token per family.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Boxes, Disc3, Loader2, Pencil, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { library } from "./api";
import { EnginePicker } from "./engine/EnginePicker";
import { ModuleParams } from "./engine/ModuleParams";
import { useEngineChoice } from "./engine/useEngineChoice";
import { ModuleEditor } from "./ModuleEditor";

const FAMILIES = [
  { id: "morceaux", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: "modules", label: "Modules", icon: Boxes },
] as const;

type FamilyId = (typeof FAMILIES)[number]["id"];

/** Poll interval for the revision map. Cheap on the server (a walk per family, only when
 *  something moved) and slow enough that a library nobody is touching costs nothing. */
const POLL_MS = 3000;

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function Library() {
  const [family, setFamily] = useState<FamilyId>("morceaux");
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The module whose parameters are on screen. Modules only — a sample has none to ask for.
  const [picked, setPicked] = useState<MediatekEntry | null>(null);
  // …and the one being EDITED, which takes over the whole screen. Only the médiathèque is
  // editable, so this is the one place in the repo a module can be written from.
  const [editing, setEditing] = useState<MediatekEntry | null>(null);
  // No socket of its own — it only lists and remembers. useModuleEngine holds the
  // connection, and two hooks opening one would be two connections from one tab.
  const choice = useEngineChoice();
  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});

  useEffect(() => {
    void library
      .summary()
      .then((s) => {
        setPresent(s.present);
        setCounts(s.counts);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async (f: FamilyId, rev: string) => {
    try {
      const l = await library.list(f);
      seen.current[f] = rev;
      setEntries(l.entries);
      setCounts((c) => ({ ...c, [f]: l.entries.length }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // One poll drives every family: fetch the token map, and reload the SELECTED family only
  // if its token moved. A family nobody is looking at just updates its count on switch.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { present: p, revisions } = await library.revisions();
        if (stop) return;
        setPresent(p);
        const rev = revisions[family];
        if (rev !== undefined && seen.current[family] !== rev)
          await load(family, rev);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [family, load]);

  // The editor replaces the catalogue rather than sitting beside it: it needs both halves
  // of the width, and there is nothing to compare against while editing one module.
  if (editing)
    return <ModuleEditor entry={editing} onBack={() => setEditing(null)} />;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-baseline gap-3 border-b px-6 py-3">
        <span className="text-lg font-semibold tracking-tight">mediatek</span>
        <span className="text-xs text-muted-foreground">
          la médiathèque de studio
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {VERSION}
        </span>
        {/* The médiathèque's first settings control. Here and not in the editor: the editor
            REPLACES this screen, so a choice made there could never be seen or changed
            from the catalogue. */}
        <div className="ml-auto">
          <EnginePicker
            ranked={choice.ranked}
            chosenId={choice.chosenId}
            onChoose={choice.choose}
            onRetry={choice.refresh}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-r p-3">
          {FAMILIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setFamily(id);
                setEntries(null);
                setPicked(null);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                family === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              <span className="tabular-nums text-xs">{counts[id] ?? 0}</span>
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          {error ? (
            <Card className="p-4 text-sm text-destructive">{error}</Card>
          ) : present === false ? (
            // A real answer, not a failure: the volume is mounted but nothing is in it yet.
            <Card className="p-6 text-sm text-muted-foreground">
              La médiathèque est vide pour l'instant.
            </Card>
          ) : entries === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : entries.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Rien dans cette famille pour l'instant.
            </Card>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline gap-3 rounded-md px-3 py-2 hover:bg-accent/40"
                  onClick={() => setPicked((p) => (p?.id === e.id ? null : e))}
                >
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {/* Not filed: found on disk with no sidecar. Worth SAYING rather than hiding. */}
                  {e.meta?.catalogued === false ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      non catalogué
                    </span>
                  ) : null}
                  {e.meta?.artist ? (
                    <span className="text-xs text-muted-foreground">
                      {String(e.meta.artist)}
                    </span>
                  ) : null}
                  {e.meta?.pack ? (
                    <span className="text-xs text-muted-foreground">
                      {String(e.meta.pack)}
                    </span>
                  ) : null}
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {e.kind}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {bytes(e.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </main>

        {/* Only for modules: it is the one family with a plugin behind it, and the engine
            is the only thing that knows what that plugin's parameters are called. */}
        {family === "modules" && picked ? (
          <aside className="w-96 shrink-0 overflow-auto border-l p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {picked.name}
              </span>
              <Button size="sm" onClick={() => setEditing(picked)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Éditer
              </Button>
            </div>
            <ModuleParams entry={picked} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
