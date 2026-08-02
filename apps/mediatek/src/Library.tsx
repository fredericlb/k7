// Library.tsx — the catalogue, read-only: the three families down the side, their entries
// in the middle. Refetches a family only when ITS revision moved, which is the whole
// reason the service hands out one token per family.

import { Card } from "@frediverse/ui/card";
import type { MediatekEntry } from "@studio/mediatek/types";
import { Boxes, Disc3, Loader2, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { library, type ServiceLink } from "./api";

const FAMILIES = [
  { id: "morceaux", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: "modules", label: "Modules", icon: Boxes },
] as const;

type FamilyId = (typeof FAMILIES)[number]["id"];

/** Poll interval for the revision map. Cheap on the server (a walk per family, only when
 *  something moved) and slow enough that a library nobody is touching costs nothing. */
const POLL_MS = 3000;

function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function Library({ link }: { link: ServiceLink }) {
  const api = useRef(library(link)).current;
  const [family, setFamily] = useState<FamilyId>("morceaux");
  const [root, setRoot] = useState("");
  const [present, setPresent] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<MediatekEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The revision each family's listing was fetched at — the refetch condition.
  const seen = useRef<Record<string, string>>({});

  useEffect(() => {
    void api
      .summary()
      .then((s) => {
        setPresent(s.present);
        setRoot(s.root);
        setCounts(s.counts);
      })
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const load = useCallback(
    async (f: FamilyId, rev: string) => {
      try {
        const l = await api.list(f);
        seen.current[f] = rev;
        setEntries(l.entries);
        setCounts((c) => ({ ...c, [f]: l.entries.length }));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api],
  );

  // One poll drives every family: fetch the token map, and reload the SELECTED family only
  // if its token moved. A family nobody is looking at just updates its count on switch.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { present: p, revisions } = await api.revisions();
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
  }, [api, family, load]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-baseline gap-3 border-b px-6 py-3">
        <span className="text-lg font-semibold tracking-tight">mediatek</span>
        {root ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {root}
          </span>
        ) : null}
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
            // A real answer, not a failure: nothing has created a library yet.
            <Card className="p-6 text-sm text-muted-foreground">
              Aucune médiathèque à <span className="font-mono">{root}</span>.
              Elle est créée au démarrage du service local.
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
      </div>
    </div>
  );
}
