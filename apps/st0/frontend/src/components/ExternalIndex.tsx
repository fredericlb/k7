// ExternalIndex.tsx — `/external`: every surface declared by the project the engine is HOLDING,
// which is the one a second device can join rather than displace. The page a tablet opens first,
// and the one a PWA installed from it starts on. No project in the address, so no ProjectGate:
// it needs the account and a machine to ask, exactly as the home page does, and claims no engine.
//
// See ../docs/external.md.

import { Button } from "@frediverse/ui/button";
import type {
  RepoSummary,
  ServedProject,
  SurfacedProject,
} from "@studio/web-protocol";
import {
  Disc3,
  type LucideIcon,
  RefreshCw,
  ServerOff,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, engines } from "../api";
import { engineMachine, externalHref, projects } from "../projects/api";
import type { Machine } from "../projects/machine";
import { PANE_META } from "../shellMeta";

/** The service memoizes this listing for five seconds; asking faster only burns requests. */
const POLL_MS = 5000;

export function ExternalIndex() {
  // `undefined` while probing — "no machine" is a refusal to draw and "still looking" is not.
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [rows, setRows] = useState<SurfacedProject[]>([]);
  // What the engine is HOLDING, which is not what the disk has — see where it is fetched.
  const [served, setServed] = useState<ServedProject | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  /** The account, then the machine, and `find()` and never `hold()` — a lease is a claim ON A PROJECT, which this menu has none of. */
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

  /** The two halves of one answer together — a row is drawn only when both agree, so two polls would leave the menu empty for a beat. */
  const load = useCallback(async (m: Machine) => {
    try {
      const [surfaced, holding] = await Promise.all([
        engineMachine.surfacedProjects(m),
        engineMachine.servedProject(m),
      ]);
      setRows(surfaced);
      setServed(holding);
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

  /** pl8's register, for one reason: which workspaces can be named by their REPOSITORY, so the tablet and the editor make one claim. */
  useEffect(() => {
    projects
      .list()
      .then((r) => setRepos(r.repos))
      // No register is not a failure of this page: every row falls back to its `@local` address, which resolves on this machine.
      .catch(() => setRepos([]));
  }, []);
  const registered = useMemo(() => new Set(repos.map((r) => r.name)), [repos]);

  /** The row the engine is holding, if the disk still has it — one project, by construction. */
  const open = useMemo(
    () =>
      served
        ? (rows.find(
            (p) => p.workspace === served.workspace && p.path === served.path,
          ) ?? null)
        : null,
    [rows, served],
  );

  /** One row per SURFACE rather than per project, and only for the project ABOVE — any other row would move the engine off what is playing. */
  const entries = useMemo(
    () =>
      open
        ? open.surfaces.map((s) => ({
            key: `${open.workspace}/${open.path}/${s.id}`,
            surface: s,
            href: externalHref(open, s.id, registered),
          }))
        : [],
    [open, registered],
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
        {/* The PROJECT is the title and "Surfaces" the line under it, since every row below belongs to one song (../docs/external.md). */}
        <span className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium">
            {open ? label(open) : "Surfaces"}
          </h1>
          {open ? (
            <span className="block truncate text-xs text-muted-foreground">
              Surfaces
            </span>
          ) : null}
        </span>
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
                {/* Same tab deliberately: installed as a PWA a `_blank` would strand the surface in a window with no way out. */}
                <a
                  href={e.href}
                  className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:bg-accent"
                >
                  <SurfaceIcon type={e.surface.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {e.surface.id}
                    </span>
                    {/* The TYPE, there being four of them: the file's own name need not say which screen it is. */}
                    <span className="block truncate text-xs text-muted-foreground">
                      {typeLabel(e.surface.type)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : busy ? null : served ? (
          <Empty icon={<Disc3 className="h-8 w-8" />}>
            <p className="text-sm">Aucune surface dans ce projet.</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              Un projet déclare ses écrans dans son dossier{" "}
              <code>surfaces/</code>. Celui qui est ouvert n'en déclare aucun.
            </p>
          </Empty>
        ) : (
          /* The other empty, and a different fact: the disk may hold surfaces, but with nothing loaded each would START a project rather than join one. */
          <Empty icon={<Disc3 className="h-8 w-8" />}>
            <p className="text-sm">Aucun projet ouvert sur le moteur.</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              Une surface rejoint le projet que le moteur tient déjà. Ouvrez-en
              un dans l'éditeur et cette liste se remplira.
            </p>
          </Empty>
        )}
      </main>
    </div>
  );
}

/** What these rows are surfaces OF: the project, by the name a person reads. */
function label(p: SurfacedProject): string {
  const where = p.repoName ?? p.workspace;
  return p.path === "." ? where : `${where} / ${p.path}`;
}

/** A surface's type as a glyph and as a word, out of the shell's own pane table — an unknown type is drawn as itself, not dropped. */
const paneMeta = (type: string) =>
  (PANE_META as Partial<Record<string, { icon: LucideIcon; label: string }>>)[
    type
  ];

function SurfaceIcon({ type }: { type: string }) {
  const Icon = paneMeta(type)?.icon ?? Disc3;
  return <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />;
}

const typeLabel = (type: string): string => paneMeta(type)?.label ?? type;

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
