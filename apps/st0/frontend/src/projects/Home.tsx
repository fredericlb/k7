// Home.tsx — what st0 draws when its address names NO project: the machine's workspaces and the
// projects in them, the libraries, the shares, the key. It holds the async — identity, machine,
// and the two polls — for the presentational body beside it. The project list comes from the
// MACHINE and so needs one; the rest of the screen reads without. See ../../docs/projects.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import { AskHost } from "@studio/project-shell/ask";
import type { MachineWorkspace, ShareSummary } from "@studio/web-protocol";
import { EXTERNAL_INDEX } from "@studio/web-protocol/projects";
import {
  Library,
  RefreshCw,
  Server,
  ServerOff,
  SlidersHorizontal,
  Tablet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, engines } from "../api";
import { CommandBar, type CommandBarHandle } from "../components/CommandBar";
import { RightPanel } from "../components/RightPanel";
import { desktop } from "../desktop";
import { useLocale } from "../i18n";
import { HomeSettings } from "../settings/HomeSettings";
import { DOUBLE_SHIFT_MS } from "../shellMeta";
import { engineMachine, pl8Url, shares as sharesApi } from "./api";
import {
  type ArmedDelete,
  buildHomePalette,
  HOME_ACTS,
  homeArgValues,
  runHomeCommand,
} from "./homeCommands";
import type { Machine } from "./machine";
import { ProjectsPane } from "./ProjectsPane";

/** The médiathèque's own: brisk enough that a finishing `git fetch` shows, slow enough to cost nothing on a ten-row list. */
const POLL_MS = 3000;

/** The open workspace travels in the QUERY, not in the path: the path belongs to launching, and a query bookmarks and answers Back. */
const WS_PARAM = "ws";

export function Home() {
  const [params, setParams] = useSearchParams();
  const openWs = params.get(WS_PARAM);

  // Asked once: a hosted origin will not grow the route mid-session (../desktop.ts). The
  // SERVER comes back with it, because the catalogue link needs it — see the pl8 button.
  const [isDesktop, setIsDesktop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    void desktop.state().then((d) => {
      setIsDesktop(d !== null);
      setServer(d?.server ?? null);
    });
  }, []);

  const [workspaces, setWorkspaces] = useState<MachineWorkspace[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The chosen machine, or null; `undefined` until probed — "none" is a refusal we draw, "looking" is not.
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [probing, setProbing] = useState(false);

  /** Identity, then the machine — and `find()` and NOTHING else: a claim is a lease ON A PROJECT, which this page has none of. */
  const probe = useCallback(async () => {
    setProbing(true);
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
      // A failed probe is not this page failing: it just leaves the two buttons grey.
      setMachine(null);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // What was loaded last pass, per service. A token says "current", not "in hand" — hence it is set only after the list is.
  const seen = useRef<{ shares: string }>({ shares: "" });

  const loadShares = useCallback(async (rev: string) => {
    try {
      const r = await sharesApi.list();
      seen.current.shares = rev;
      setShares(r.shares);
    } catch {
      /* the card keeps what it held, and says so itself */
    }
  }, []);

  /** Reload everything next tick without waiting for a revision: a write from here already knows. */
  const changed = useCallback(() => {
    seen.current = { shares: "" };
  }, []);

  /** The project list comes from the MACHINE and nowhere else; with none there is nothing to ask, which is the price of the move. */
  const loadWorkspaces = useCallback(async (m: Machine) => {
    try {
      setWorkspaces(await engineMachine.workspaces(m));
      setError(null);
    } catch (e) {
      // The machine IS the screen's subject: say it failed rather than draw an empty list.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (machine === undefined) return; // still probing: neither a list nor a refusal
    if (machine === null) {
      setWorkspaces([]);
      setBusy(false);
      return;
    }
    let stop = false;
    const tick = async () => {
      if (!stop) await loadWorkspaces(machine);
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [machine, loadWorkspaces]);

  /** What pl8 still holds: the shares, which are its own bytes. A repository is a folder on a machine and is asked of that machine. */
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await sharesApi.revision();
        if (!stop && seen.current.shares !== revision)
          await loadShares(revision);
      } catch {
        /* idem */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [loadShares]);

  /** This screen's command bar and status line, with its own vocabulary (`homeCommands.ts`) rather than the editor's. */
  const cmdRef = useRef<CommandBarHandle>(null);
  const { locale } = useLocale();
  const palette = useMemo(() => buildHomePalette(locale), [locale]);
  const [said, setSaid] = useState<{ text: string; refused: boolean } | null>(
    null,
  );
  /** The project a `project delete init` named, awaiting its confirm — a ref, read by the next command and never drawn. */
  const armed = useRef<ArmedDelete | null>(null);

  /** Reload NOW after a write from here, or a just-created project would take three seconds to appear. */
  const reread = useCallback(() => {
    changed();
    if (machine) void loadWorkspaces(machine);
  }, [changed, machine, loadWorkspaces]);

  const run = useCallback(
    async (line: string) => {
      setSaid(null);
      const known = await runHomeCommand(line, {
        machine: machine ?? null,
        workspaces,
        openWs,
        acts: HOME_ACTS,
        say: (text) => setSaid({ text, refused: false }),
        refuse: (text) => setSaid({ text, refused: true }),
        changed: reread,
        armed,
      });
      // A line this screen does not know is refused HERE: no service behind it to pass it to.
      if (!known)
        setSaid({
          text: `« ${line.trim()} » n'est pas une commande de cet écran`,
          refused: true,
        });
    },
    [machine, workspaces, openWs, reread],
  );

  /** Two bare Shifts give it the keyboard, the editor's own gesture; the bar never takes focus itself, and `e.repeat` drops a held Shift. */
  const lastShiftAt = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) {
        lastShiftAt.current = 0;
        return;
      }
      const now = e.timeStamp;
      if (now - lastShiftAt.current <= DOUBLE_SHIFT_MS) {
        lastShiftAt.current = 0;
        cmdRef.current?.focus();
      } else lastShiftAt.current = now;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Unfold a workspace, or go back to the list — `replace`, browsing three of them not being worth three back-button entries. */
  const open = useCallback(
    (name: string | null) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (name) next.set(WS_PARAM, name);
          else next.delete(WS_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Without this, `askConfirm` answers NO with no host to draw on and every destructive
          button on this page silently does nothing — see @studio/project-shell/ask. */}
      <AskHost />
      <AppHeader
        title="st0"
        subtitle="Projets"
        className="z-20"
        actions={
          <>
            {/* Which machine will write, said BEFORE the click: without one two buttons here are grey, and finding out by clicking is what this avoids. */}
            <span
              className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
              title={
                machine
                  ? `Les projets sont lus, créés et supprimés sur ${machine.fileBase}`
                  : "Aucune machine moteur joignable — les projets sont ses dossiers, donc la liste attend qu’elle réponde"
              }
            >
              {machine ? (
                <Server className="h-3.5 w-3.5" />
              ) : (
                <ServerOff className="h-3.5 w-3.5 text-amber-500" />
              )}
              {machine === undefined
                ? "…"
                : machine
                  ? "machine prête"
                  : "aucune machine"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              title="Re-sonder les moteurs"
              disabled={probing}
              onClick={() => void probe()}
            >
              <RefreshCw
                className={probing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
            </Button>
            {/* pl8 — the catalogue a project USES, one link away and on the HOME page alone.
                Hosted, it is the same origin and opens in the same tab (../../docs/projects.md).
                On the DESKTOP it is the paired server's, opened in the system BROWSER: pl8 is a
                hosted app, our origin serves only its offline shim, and `target="_blank"` is
                what the app turns into `shell.openExternal`. Unpaired there is no catalogue to
                open, so the button says so instead of linking at a 503. */}
            {/* Settings — a PANEL and not a page, so the list of what needs the key stays on
                screen while it is pasted (../settings/HomeSettings.tsx). */}
            <Button
              variant="ghost"
              size="sm"
              title="Réglages — la clé de déploiement"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" /> Réglages
            </Button>
            {/* Surfaces — `/external`, and an `<a>` rather than a route, since a client navigation would keep the editor's manifest (../../docs/external.md). */}
            <Button variant="ghost" size="sm" asChild>
              <a
                href={`${import.meta.env.BASE_URL}${EXTERNAL_INDEX}`}
                title="Surfaces — le menu qu'un second appareil ouvre, et installe"
              >
                <Tablet className="h-4 w-4" /> Surfaces
              </a>
            </Button>
            {isDesktop && !server ? (
              <Button
                variant="secondary"
                size="sm"
                disabled
                title="pl8 — la médiathèque : associez un serveur dans les Réglages pour l'ouvrir"
              >
                <Library className="h-4 w-4" /> pl8
              </Button>
            ) : (
              <Button variant="secondary" size="sm" asChild>
                <a
                  href={pl8Url(server)}
                  {...(isDesktop
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                  title="pl8 — la médiathèque : morceaux, samples, prises"
                >
                  <Library className="h-4 w-4" /> pl8
                </a>
              </Button>
            )}
          </>
        }
      />

      {/* A ROW from here down: the settings panel docks beside the repositories, not over them. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {error && (
            <code className="mx-6 mt-3 overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
              {error}
            </code>
          )}

          <ProjectsPane
            workspaces={workspaces}
            shares={shares}
            busy={busy}
            openWs={openWs}
            machine={machine ?? null}
            onOpen={open}
            onChanged={changed}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
        <RightPanel open={settingsOpen} width="w-[24rem]">
          <HomeSettings onClose={() => setSettingsOpen(false)} />
        </RightPanel>
      </div>

      {/* The bar, full width at the bottom on the editor's own terms, with what it said held above it in amber (../../docs/commandBar.md). */}
      <div className="shrink-0 border-t border-border bg-popover">
        {said && (
          <p
            className={`truncate px-3 pt-1.5 text-xs ${
              said.refused ? "text-amber-500" : "text-muted-foreground"
            }`}
            title={said.text}
          >
            {said.text}
          </p>
        )}
        <div className="flex items-center px-3 py-2">
          <CommandBar
            ref={cmdRef}
            commands={palette}
            // Everything a field can offer is already on screen, so the answer is immediate.
            listArg={async (command, prior) =>
              homeArgValues(command, prior.length, {
                machine: machine ?? null,
                workspaces,
                openWs,
              })
            }
            onRun={(line) => void run(line)}
            onClose={() => cmdRef.current?.blur()}
          />
        </div>
      </div>
    </div>
  );
}
