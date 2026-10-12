// ExternalIndex.tsx — `/external`: every surface declared by the project the engine is HOLDING,
// which is the one a second device can join rather than displace. The page a tablet opens first,
// and the one a PWA installed from it starts on. No project in the address, so no ProjectGate:
// it needs the account and a machine to ask, exactly as the home page does, and claims no engine.
//
// See ../docs/external.md.

import { Button } from "@frediverse/ui/button";
import {
  Disc3,
  type LucideIcon,
  RefreshCw,
  ServerOff,
  Unplug,
} from "@frediverse/ui/icons";
import { fileTokenOf } from "@studio/engine-browser/probe";
import type { ServedProject, SurfacedProject } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, engines } from "../api";
import { needingPairing, PairThisDevice } from "../pairing/PairThisDevice";
import { m } from "../paraglide/messages.js";
import { accountFiles, externalHref } from "../projects/api";
import type { AccountFiles } from "../projects/workspaceOps";
import { PANE_META, VIEWPORT_META } from "../shellMeta";
import type { RankedEngine } from "../types";
import { pollWhileVisible } from "../visiblePoll";

/** The service memoizes this listing for five seconds; asking faster only burns requests. */
const POLL_MS = 5000;

export function ExternalIndex() {
  // `undefined` while probing — "no machine" is a refusal to draw and "still looking" is not.
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);
  const [rows, setRows] = useState<SurfacedProject[]>([]);
  // What the engine is HOLDING, which is not what the disk has — see where it is fetched.
  const [served, setServed] = useState<ServedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // Engines that answered this device and refuse it until paired — the card drawn in place of "no engine".
  const [pairable, setPairable] = useState<RankedEngine[]>([]);

  /** The account, then the machine, and `find()` and never `hold()` — a lease is a claim ON A PROJECT, which this menu has none of. */
  const probe = useCallback(async () => {
    try {
      const me = await api.getMe().catch(() => null);
      const userEmail = me?.email || me?.sub || "unknown";
      const { ranked, chosen } = await engines.find();
      setPairable(chosen ? [] : needingPairing(ranked));
      setFileService(
        chosen?.fileBase && fileTokenOf(chosen)
          ? {
              fileBase: chosen.fileBase,
              token: fileTokenOf(chosen) ?? "",
              userEmail,
              // This menu edits nothing of the admins'.
              admin: false,
            }
          : null,
      );
    } catch {
      setFileService(null);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  /** The two halves of one answer together — a row is drawn only when both agree, so two polls would leave the menu empty for a beat. */
  const load = useCallback(async (m: AccountFiles) => {
    try {
      const [surfaced, holding] = await Promise.all([
        accountFiles.surfacedProjects(m),
        accountFiles.servedProject(m),
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
    if (!fileService) {
      if (fileService === null) setBusy(false);
      return;
    }
    void load(fileService);
    return pollWhileVisible(() => void load(fileService), POLL_MS);
  }, [fileService, load]);

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
            href: externalHref(open, s.id),
          }))
        : [],
    [open],
  );

  const refresh = () => {
    setBusy(true);
    if (fileService) void load(fileService);
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
          title={m["ext.refresh"]()}
          onClick={refresh}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {fileService === null && pairable.length ? (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
            {pairable.map((r) => (
              <PairThisDevice
                key={r.engine.id}
                engine={r}
                onPaired={() => void probe()}
              />
            ))}
          </div>
        ) : fileService === null ? (
          <Empty icon={<ServerOff className="h-8 w-8" />}>
            <p className="text-sm">{m["ext.noEngine"]()}</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              {m["ext.noEngineBody"]()}
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
            <p className="text-sm">{m["ext.noSurfaces"]()}</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              Un projet déclare ses écrans dans son dossier{" "}
              <code>surfaces/</code>. Celui qui est ouvert n'en déclare aucun.
            </p>
          </Empty>
        ) : (
          /* The other empty, and a different fact: the disk may hold surfaces, but with nothing loaded each would START a project rather than join one. */
          <Empty icon={<Disc3 className="h-8 w-8" />}>
            <p className="text-sm">{m["ext.noOpenProject"]()}</p>
            <p className="max-w-xs text-center text-xs opacity-70">
              {m["ext.noProject"]()}
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
  (
    ({ ...PANE_META, viewport: VIEWPORT_META }) as Partial<
      Record<string, { icon: LucideIcon; label: string }>
    >
  )[type];

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
