// ExternalIndex.tsx — `/external`: every surface this account could put on a second device,
// across every project on the machine. The page a tablet opens first, and the one a PWA installed
// from it starts on. No project in the address, so no ProjectGate: it needs the account and a
// machine to ask, exactly as the home page does, and claims no engine.
//
// See ../docs/external.md.

import { Button } from "@frediverse/ui/button";
import type { RepoSummary, SurfacedProject } from "@studio/web-protocol";
import { Disc3, RefreshCw, ServerOff, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, engines } from "../api";
import { engineMachine, externalHref, projects } from "../projects/api";
import type { Machine } from "../projects/machine";
import { isRemotable } from "./ExternalSurface";

/** The service memoizes this listing for five seconds; asking faster only burns requests. */
const POLL_MS = 5000;

export function ExternalIndex() {
  // `undefined` while probing — "no machine" is a refusal to draw and "still looking" is not.
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [rows, setRows] = useState<SurfacedProject[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  /**
   * The account, then the machine — in that order, as the home page does it and for its reason:
   * the file service trusts `USER_HEADER`, so a machine with nobody to name is one nothing can be
   * asked of.
   *
   * `find()` and never `hold()`. A lease is a claim ON A PROJECT and this page has none; taking
   * one from a menu would evict whoever is playing on that engine. Following a row DOES claim,
   * through the gate stack, which is where a claim belongs.
   */
  const probe = useCallback(async () => {
    try {
      const me = await api.getMe().catch(() => null);
      const userEmail = me?.email || me?.sub || "unknown";
      const { chosen } = await engines.find();
      setMachine(
        chosen?.fileBase && chosen.token
          ? { fileBase: chosen.fileBase, token: chosen.token, userEmail }
          : null,
      );
    } catch {
      setMachine(null);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const load = useCallback(async (m: Machine) => {
    try {
      setRows(await engineMachine.surfacedProjects(m));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!machine) {
      if (machine === null) setBusy(false);
      return;
    }
    void load(machine);
    const t = setInterval(() => void load(machine), POLL_MS);
    return () => clearInterval(t);
  }, [machine, load]);

  /**
   * pl8's register, fetched for one reason: which of these workspaces can be named by their
   * REPOSITORY rather than by `@local`. Not a list this page draws.
   *
   * It matters more here than on the home page. The engine identifies a project by its address
   * (`projectClaimKey`), so a tablet arriving at `@local/…` while the editor holds `/<dépôt>/…`
   * would be two claims on one song — and the second one evicts the first.
   */
  useEffect(() => {
    projects
      .list()
      .then((r) => setRepos(r.repos))
      // No register is not a failure of this page: every row falls back to its `@local` address,
      // which resolves on this machine and nowhere else. That is the honest answer.
      .catch(() => setRepos([]));
  }, []);
  const registered = useMemo(() => new Set(repos.map((r) => r.name)), [repos]);

  /**
   * One row per SURFACE rather than per project — the thing being chosen is a screen, and a
   * project that declares two decks is two entries on a tablet's menu, not one to drill into.
   *
   * Filtered to what a second device can actually drive. Every surface has an address, but a
   * `timeline` reached this way can only explain that the editor draws it, and a menu of dead
   * ends is worse than a short menu. Same predicate the destination checks.
   */
  const entries = useMemo(
    () =>
      rows.flatMap((p) =>
        p.surfaces
          .filter((s) => isRemotable(s.type))
          .map((s) => ({
            key: `${p.workspace}/${p.path}/${s.id}`,
            project: p,
            surface: s,
            href: externalHref(p, s.id, registered),
          })),
      ),
    [rows, registered],
  );

  const refresh = () => {
    setBusy(true);
    if (machine) void load(machine);
    else void probe();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Disc3 className="h-5 w-5 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate text-base font-medium">
          Surfaces
        </h1>
        <Button
          size="icon"
          variant="ghost"
          title="Rafraîchir"
          onClick={refresh}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {machine === null ? (
          <Empty icon={<ServerOff className="h-8 w-8" />}>
            <p className="text-sm">Aucun moteur joignable.</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              Les surfaces vivent sur la machine qui tient les copies de travail
              : sans moteur, il n'y a rien à commander.
            </p>
          </Empty>
        ) : error ? (
          <Empty icon={<Unplug className="h-8 w-8" />}>
            <p className="max-w-xs text-center text-sm">{error}</p>
          </Empty>
        ) : entries.length ? (
          <ul className="mx-auto flex w-full max-w-xl flex-col gap-2">
            {entries.map((e) => (
              <li key={e.key}>
                {/* Same tab, deliberately: installed as a PWA there is no tab to open and no
                    address bar to come back from, so a `_blank` would strand the surface in a
                    window with no way out. The surface's own header links back here. */}
                <a
                  href={e.href}
                  className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-accent"
                >
                  <Disc3 className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {e.surface.id}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {label(e.project)}
                    </span>
                  </span>
                  {/* The workspace's open project. Worth a word on a menu: that row reaches an
                      engine that is already on this song, and any other row moves it. */}
                  {e.project.active ? (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
                      ouvert
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        ) : busy ? null : (
          <Empty icon={<Disc3 className="h-8 w-8" />}>
            <p className="text-sm">Aucune surface à commander.</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              Un projet en déclare dans son dossier <code>surfaces/</code>. Les
              pupitres sont les seuls qu'un second appareil puisse tenir.
            </p>
          </Empty>
        )}
      </main>
    </div>
  );
}

/** What this row is a surface OF: the project, by the name a person reads. */
function label(p: SurfacedProject): string {
  const where = p.repoName ?? p.workspace;
  return p.path === "." ? where : `${where} / ${p.path}`;
}

function Empty({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}
