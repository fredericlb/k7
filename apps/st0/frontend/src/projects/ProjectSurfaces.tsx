// ProjectSurfaces.tsx — the "Surfaces" half of a project row's popin: one QR code per screen a
// second device can drive, the whole project first. A code and nothing else — scanning IS the
// point, and an address written out is what this replaces rather than something to keep beside it.
// The addresses are LIVE, unlike the frozen shares in the other tab (docs/external.md).
// See ../../docs/projects.md.

import type { SurfaceRef } from "@studio/web-protocol";
import { externalOf } from "@studio/web-protocol/projects";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { PANE_META } from "../shellMeta";
import { engineMachine } from "./api";
import type { Machine } from "./machine";
import { remoteUrl } from "./remoteUrl";

/** Big enough to scan off a laptop screen at arm's length, small enough that three fit in a row. */
const QR_PX = 168;

/** One tile: a screen, and the address a phone opens it at. */
interface Entry {
  key: string;
  label: string;
  detail: string;
  url: string;
}

/** The project itself first — a surface is a screen ONTO it, so the thing itself is not one of them. */
function entriesFor(
  label: string,
  projectUrl: string,
  surfaces: SurfaceRef[],
): Entry[] {
  return [
    {
      key: "@project",
      label,
      detail: "le projet entier — l'éditeur, à distance",
      url: projectUrl,
    },
    ...surfaces.map((s) => ({
      key: s.id,
      label: s.id,
      detail: PANE_META[s.type as keyof typeof PANE_META]?.label ?? s.type,
      url: externalOf(projectUrl, s.id),
    })),
  ];
}

export function ProjectSurfaces({
  label,
  projectUrl,
  workspace,
  path,
  machine,
  lanUrls,
}: {
  /** The project's name as the row shows it. */
  label: string;
  /** Where it opens on THIS origin; rebased per device below. */
  projectUrl: string;
  workspace: string;
  /** Workspace-relative, as `/workspaces/surfaces` spells it. */
  path: string;
  /** Absent with no engine: the surfaces are folders on its disk, so there is nothing to list. */
  machine: Machine | null;
  /** Where a second device reaches this app (apps/studio-desktop/docs/externals.md). */
  lanUrls: readonly string[];
}) {
  const [surfaces, setSurfaces] = useState<SurfaceRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState(0);

  // Mounted only when its tab is open, so this is the fetch deferred until someone asks: the
  // list costs a scan per project on the machine.
  useEffect(() => {
    if (!machine) return;
    let live = true;
    setError(null);
    void engineMachine
      .surfacedProjects(machine)
      .then((rows) => {
        if (!live) return;
        const mine = rows.find(
          (r) => r.workspace === workspace && r.path === path,
        );
        setSurfaces(mine?.surfaces ?? []);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [machine, workspace, path]);

  const chosen = lanUrls[base];
  const rebase = useCallback(
    (url: string) =>
      remoteUrl(url, chosen ? [chosen] : [], window.location.origin),
    [chosen],
  );

  const entries =
    surfaces === null ? null : entriesFor(label, projectUrl, surfaces);

  if (!machine)
    return (
      <p className="text-xs text-muted-foreground">
        Aucune machine moteur joignable. Les surfaces sont déclarées dans le
        dossier <code>surfaces/</code> du projet, sur le disque de cette machine
        : sans elle, il n'y a rien à lister.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      {/* Several interfaces means several answers, and one of them is usually a virtual
          adapter: the choice is offered rather than guessed. */}
      {lanUrls.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Depuis
          <select
            className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 font-mono"
            value={base}
            onChange={(e) => setBase(Number(e.target.value))}
          >
            {lanUrls.map((u, i) => (
              <option key={u} value={i}>
                {u}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {entries === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ul className="grid max-h-[55vh] grid-cols-2 gap-4 overflow-y-auto sm:grid-cols-3">
          {entries.map((e) => (
            <Tile key={e.key} entry={e} url={rebase(e.url)} />
          ))}
        </ul>
      )}

      {entries?.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Ce projet ne déclare aucune surface — un projet les écrit dans son
          dossier <code>surfaces/</code>. Le code ci-dessus ouvre l'éditeur
          complet, ce qui marche mais demande un écran.
        </p>
      )}
    </div>
  );
}

/** One QR code and the name of what it opens. Nothing else: an address to read is the thing this replaces. */
function Tile({ entry, url }: { entry: Entry; url: string | null }) {
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    let live = true;
    setFailed(false);
    void QRCode.toDataURL(url, {
      width: QR_PX,
      margin: 1,
      // Drawn on the popin's own background, so the code carries no card of its own.
      color: { dark: "#e5e5e5ff", light: "#00000000" },
    })
      .then((d) => live && setPng(d))
      // Said rather than swallowed: a tile that spins for ever reads as a slow network.
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [url]);

  return (
    <li className="flex flex-col items-center gap-1 rounded-lg border border-border p-3">
      <span className="w-full truncate text-center text-sm">{entry.label}</span>
      <span className="w-full truncate text-center text-xs text-muted-foreground">
        {entry.detail}
      </span>
      <span
        className="mt-1 flex items-center justify-center"
        style={{ width: QR_PX, height: QR_PX }}
      >
        {url === null ? (
          <span className="text-center text-xs text-muted-foreground">
            cette machine n'a pas d'adresse réseau
          </span>
        ) : failed ? (
          <span className="text-center text-xs text-destructive">
            le code n'a pas pu être dessiné
          </span>
        ) : png ? (
          <img
            src={png}
            width={QR_PX}
            height={QR_PX}
            alt={`QR code pour ${entry.label}`}
          />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </span>
    </li>
  );
}
