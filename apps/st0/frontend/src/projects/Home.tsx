// Home.tsx — what st0 draws when its address names NO project: the account's workspaces and the
// projects in them, the libraries, the shares, the key. It holds the async — identity, the file
// service, and the two polls — for the presentational body beside it. The list is the SERVER's
// files and needs no engine. See ../../docs/projects.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import {
  LibraryBig,
  RefreshCw,
  Server,
  ServerOff,
  SlidersHorizontal,
  Tablet,
} from "@frediverse/ui/icons";
import { AskHost } from "@studio/project-shell/ask";
import { Toaster } from "@studio/project-shell/toast";
import { AppSwitch } from "@studio/ui-app-switch";
import type {
  AccountLibrary,
  AccountWorkspace,
  ShareSummary,
} from "@studio/web-protocol";
import { EXTERNAL_INDEX } from "@studio/web-protocol/projects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CommandBar, type CommandBarHandle } from "../components/CommandBar";
import { GitBusyOverlay } from "../components/GitBusy";
import { RightPanel } from "../components/RightPanel";
import { desktop } from "../desktop";
import { useLocale } from "../i18n";
import { m } from "../paraglide/messages.js";
import { findAccountFiles } from "../settings/accountFiles";
import { HomeSettings } from "../settings/HomeSettings";
import { DOUBLE_SHIFT_MS } from "../shellMeta";
import { accountFiles, librariesHref, shares as sharesApi } from "./api";
import {
  type ArmedDelete,
  buildHomePalette,
  HOME_ACTS,
  homeArgValues,
  runHomeCommand,
} from "./homeCommands";
import { ProjectsPane } from "./ProjectsPane";
import type { AccountFiles } from "./workspaceOps";

/** The médiathèque's own: brisk enough that a finishing `git fetch` shows, slow enough to cost nothing on a ten-row list. */
const POLL_MS = 3000;

/** The open workspace travels in the QUERY, not in the path: the path belongs to launching, and a query bookmarks and answers Back. */
const WS_PARAM = "ws";

export function Home() {
  const [params, setParams] = useSearchParams();
  const openWs = params.get(WS_PARAM);

  // Asked once: a hosted origin will not grow the route mid-session (../desktop.ts). The
  // SERVER comes back with it, because the app switch needs it — the other apps are ITS.
  const [isDesktop, setIsDesktop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    void desktop.state().then((d) => {
      setIsDesktop(d !== null);
      setServer(d?.server ?? null);
    });
  }, []);

  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The account's file service, or null; `undefined` until asked — "none" is a refusal we draw, "looking" is not.
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);
  const [probing, setProbing] = useState(false);

  /** The account's files on the server, engine or none — and no `hold()`: a claim is a lease ON A PROJECT, which this page has none of. */
  const probe = useCallback(async () => {
    setProbing(true);
    try {
      setFileService(await findAccountFiles(false));
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // The libraries, read here for the notice and the workspace buttons; they are edited on their own page.
  const [libraries, setLibraries] = useState<AccountLibrary[] | undefined>(
    undefined,
  );
  useEffect(() => {
    if (fileService === undefined) return;
    if (fileService === null) return setLibraries([]);
    void accountFiles
      .libraries(fileService)
      .then((r) => setLibraries(r.libraries))
      .catch(() => setLibraries([]));
  }, [fileService]);

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

  /** The project list is the file service's answer, over the account's workspaces on the server. */
  // What the last poll answered, as text: an unchanged list keeps its identity, so no row re-renders.
  const lastWorkspaces = useRef("");
  const loadWorkspaces = useCallback(async (m: AccountFiles) => {
    try {
      const next = await accountFiles.workspaces(m);
      const text = JSON.stringify(next);
      if (text !== lastWorkspaces.current) {
        lastWorkspaces.current = text;
        setWorkspaces(next);
      }
      setError(null);
    } catch (e) {
      // The list IS the screen's subject: say it failed rather than draw an empty one.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (fileService === undefined) return; // still probing: neither a list nor a refusal
    if (fileService === null) {
      setWorkspaces([]);
      setBusy(false);
      return;
    }
    let stop = false;
    const tick = async () => {
      if (!stop) await loadWorkspaces(fileService);
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [fileService, loadWorkspaces]);

  /** What pl8 holds: the shares, which are its own bytes. A workspace is the file service's and is asked of it. */
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
    if (fileService) void loadWorkspaces(fileService);
  }, [changed, fileService, loadWorkspaces]);

  const run = useCallback(
    async (line: string) => {
      setSaid(null);
      const known = await runHomeCommand(line, {
        fileService: fileService ?? null,
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
          text: m["home.unknownCommand"]({ line: line.trim() }),
          refused: true,
        });
    },
    [fileService, workspaces, openWs, reread],
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
      {/* Where a workspace's compaction says what it gave back. */}
      <Toaster />
      <GitBusyOverlay />
      <AppHeader
        title="st0"
        subtitle={m["home.projects"]()}
        className="z-20"
        actions={
          <>
            {/* Whether the files answer, said BEFORE the click: without them two buttons here are grey, and finding out by clicking is what this avoids. */}
            <span
              className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
              title={
                fileService
                  ? m["home.filesReadyHint"]({ address: fileService.fileBase })
                  : m["home.noFilesHint"]()
              }
            >
              {fileService ? (
                <Server className="h-3.5 w-3.5" />
              ) : (
                <ServerOff className="h-3.5 w-3.5 text-amber-500" />
              )}
              {fileService === undefined
                ? "…"
                : fileService
                  ? m["home.filesReady"]()
                  : m["home.noFiles"]()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              title={m["home.reprobe"]()}
              disabled={probing}
              onClick={() => void probe()}
            >
              <RefreshCw
                className={probing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
            </Button>
            {/* Settings — a PANEL and not a page, so the list of what needs the key stays on
                screen while it is pasted (../settings/HomeSettings.tsx). */}
            <Button
              variant="ghost"
              size="sm"
              title={m["home.settingsHint"]()}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" /> {m["home.settings"]()}
            </Button>
            {/* Libraries — a PAGE of its own, `/libraries`: the origin's list, which an admin edits there (./LibrariesPage.tsx). */}
            <Button variant="ghost" size="sm" asChild>
              <a href={librariesHref()} title={m["home.librariesHint"]()}>
                <LibraryBig className="h-4 w-4" /> {m["home.libraries"]()}
              </a>
            </Button>
            {/* Surfaces — `/external`, and an `<a>` rather than a route, since a client navigation would keep the editor's manifest (../../docs/external.md). */}
            <Button variant="ghost" size="sm" asChild>
              <a
                href={`${import.meta.env.BASE_URL}${EXTERNAL_INDEX}`}
                title={m["home.surfacesHint"]()}
              >
                <Tablet className="h-4 w-4" /> {m["home.surfaces"]()}
              </a>
            </Button>
            {/* The way out — pl8, k7, z0 — and on the HOME page alone: opened on a project, the
                editor's header has no room for a link that leaves the session. On the DESKTOP
                those apps answer on the paired SERVER, this origin serving only st0's own
                bundle; unpaired there is nowhere to go, and the button says so rather than
                linking at a 503 (@studio/ui-app-switch/docs/appSwitch.md). */}
            <AppSwitch
              self="st0"
              origin={server}
              unavailable={
                isDesktop && !server ? m["home.appsUnavailable"]() : undefined
              }
            />
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
            fileService={fileService ?? null}
            onOpen={open}
            onChanged={changed}
            onOpenSettings={() => setSettingsOpen(true)}
            libraries={libraries}
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
                fileService: fileService ?? null,
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
