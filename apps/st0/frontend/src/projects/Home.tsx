// Home.tsx — what st0 draws when its address names NO project: the machine's workspaces and the
// projects in them, the libraries, the shares, the key. It holds the async — identity, machine,
// and the two polls — for the presentational body beside it. The project list comes from the
// MACHINE and so needs one; the rest of the screen reads without. See ../../docs/projects.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import type {
  MachineWorkspace,
  RepoSummary,
  ShareSummary,
} from "@studio/web-protocol";
import { EXTERNAL_INDEX } from "@studio/web-protocol/projects";
import { Library, RefreshCw, Server, ServerOff, Tablet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, engines } from "../api";
import { CommandBar, type CommandBarHandle } from "../components/CommandBar";
import { useLocale } from "../i18n";
import { DOUBLE_SHIFT_MS } from "../shellMeta";
import { engineMachine, pl8Url, projects, shares as sharesApi } from "./api";
import {
  type ArmedDelete,
  buildHomePalette,
  HOME_ACTS,
  homeArgValues,
  runHomeCommand,
} from "./homeCommands";
import type { Machine } from "./machine";
import { ProjectsPane } from "./ProjectsPane";

/** The médiathèque's own: brisk enough that a finishing `git fetch` shows, slow enough to cost
 *  nothing on a ten-row list. */
const POLL_MS = 3000;

/**
 * The open workspace travels in the QUERY, not in the path.
 *
 * The path belongs to launching — `parseLaunch` reads `/<repo>/<project>` before anything mounts,
 * and no segment could be added here without reading as a repository to open. A query is exactly
 * what an SPA router owns, and it bookmarks, copies and answers the back button.
 *
 * It was `?repo=<id>`, a pl8 repository id. What unfolds is a folder on the MACHINE now, and its
 * name is what designates it — legible, which the hash was not.
 */
const WS_PARAM = "ws";

export function Home() {
  const [params, setParams] = useSearchParams();
  const openWs = params.get(WS_PARAM);

  const [workspaces, setWorkspaces] = useState<MachineWorkspace[]>([]);
  // pl8's register — not a list to draw, but what decides whether a portable address resolves.
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The chosen machine, or null; `undefined` until probed — "none" is a refusal we draw, "looking" is not.
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [probing, setProbing] = useState(false);

  /**
   * Identity, then the machine — in that order and not in parallel.
   *
   * The file service trusts the `USER_HEADER`, so a machine with nobody to name is a machine
   * nothing can be done with; there is no point keeping it.
   *
   * `find()` and NOTHING else — never `hold()`. A claim is a lease ON A PROJECT and this page has
   * none, so taking one would evict somebody playing their track on that engine, from a screen
   * that only lists repositories.
   */
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
  const seen = useRef<{ repos: string; shares: string }>({
    repos: "",
    shares: "",
  });

  const loadShares = useCallback(async (rev: string) => {
    try {
      const r = await sharesApi.list();
      seen.current.shares = rev;
      setShares(r.shares);
    } catch {
      /* the card keeps what it held, and says so itself */
    }
  }, []);

  const loadRepos = useCallback(async (rev: string) => {
    try {
      const { repos: list } = await projects.list();
      seen.current.repos = rev;
      setRepos(list);
    } catch {
      /* the register is no longer the screen's subject: its absence reads on the rows */
    }
  }, []);

  /** Reload everything next tick without waiting for a revision: a write from here already knows. */
  const changed = useCallback(() => {
    seen.current = { repos: "", shares: "" };
  }, []);

  /**
   * The project list comes from the MACHINE, and from nowhere else.
   *
   * No revision token in front, unlike the shares: the file service answers the list itself behind
   * a five-second window of its own, so asking first whether it moved would be one more round trip
   * to save an already-memoised readdir.
   *
   * With no machine there is nothing to ask and nothing to show. That is the price of the move,
   * said here because here is where it is paid — the rest of the screen still reads without one.
   */
  const loadWorkspaces = useCallback(async (m: Machine) => {
    try {
      setWorkspaces(await engineMachine.workspaces(m));
      setError(null);
    } catch (e) {
      // The machine is the screen's subject now: say it failed rather than draw an empty list.
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

  /**
   * What pl8 still holds, and why this screen still asks: the REGISTER of repositories, and the
   * shares.
   *
   * The register is no longer a list to draw — the machine says what exists — but it is what makes
   * `/<repo>/<project>` resolvable, since `by-name` is asked of pl8 one click later. A copy the
   * machine has and the register does not opens as `@local`, and crossing the two is how a row
   * knows. The shares are pl8's own bytes, served to people with no account.
   */
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await projects.revision();
        if (!stop && seen.current.repos !== revision) await loadRepos(revision);
      } catch {
        /* the row says so itself */
      }
      if (stop) return;
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
  }, [loadRepos, loadShares]);

  /** This screen's command bar and status line. Its own vocabulary (`homeCommands.ts`), not the
   *  editor's: with no project, engine or file, `LOCAL_COMMANDS` would list what cannot be done. */
  const cmdRef = useRef<CommandBarHandle>(null);
  const { locale } = useLocale();
  const palette = useMemo(() => buildHomePalette(locale), [locale]);
  const [said, setSaid] = useState<{ text: string; refused: boolean } | null>(
    null,
  );
  /** The project a `project delete init` named, awaiting its confirm. A ref: read by the next
   *  command and never drawn. */
  const armed = useRef<ArmedDelete | null>(null);

  /** Reload NOW after a write from here: otherwise the machine's list waits for the next tick,
   *  and a just-created project would take three seconds to appear. */
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
        repos,
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
    [machine, workspaces, repos, openWs, reread],
  );

  /** Two bare Shifts give it the keyboard, the editor's own gesture. The bar never takes focus by
   *  itself, so without this it could only be reached by mouse; `e.repeat` drops a held Shift. */
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

  /** Unfold a workspace, or go back to the list. `replace`, because browsing three of them to see
   *  what is inside is not navigation worth three back-button entries. */
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
      <AppHeader
        title="st0"
        subtitle="Projets"
        className="z-20"
        actions={
          <>
            {/* Quelle machine écrira, dit AVANT de cliquer : sans elle deux boutons de la page
                sont gris, et découvrir pourquoi au clic est ce qu'on évite ici. */}
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
            {/* pl8 — la médiathèque. Le catalogue est ce dont un projet SE SERT : il est à un
                lien, pas devant. C'est la porte d'entrée de l'autre application depuis celle-ci,
                et elle n'est ici que sur l'ACCUEIL : ouvert sur un projet, st0 dessine l'en-tête
                de l'éditeur, où un lien qui vous ferait quitter la session n'a rien à faire.
                DANS le même onglet, à l'inverse du lien qui vient d'en face : là-bas la
                médiathèque joue quelque chose et partir l'arrêterait (apps/pl8/docs/miniPlayer.md),
                ici rien ne tourne — cette page est une liste, et on y revient par « précédent »
                avec l'arbre replié pour tout dommage. */}
            {/* Surfaces — `/external`, le menu des surfaces qu'un SECOND appareil pilote.
                Il était joignable par son adresse seule et par `ui external <surface>` dans un
                projet ouvert ; ni l'un ni l'autre ne se découvre depuis une tablette qu'on vient
                de poser sur l'ampli. Ici parce que c'est la page qu'on a sous les yeux quand on
                installe cet appareil-là : le menu porte son propre manifeste
                (`manifest-external.webmanifest`), donc l'installer DEPUIS lui démarre sur les
                surfaces plutôt que sur cette liste (../../docs/external.md).

                Un `<a>` et pas une route : `/external` est lu par `main.tsx` AVANT le routeur, et
                y arriver par navigation cliente laisserait le document sur le manifeste de
                l'éditeur — l'appareil s'installerait sur la mauvaise application. Dans le même
                onglet, comme le lien pl8 à côté et pour la même raison : rien ne tourne sur cette
                page, et « précédent » y ramène. */}
            <Button variant="ghost" size="sm" asChild>
              <a
                href={`${import.meta.env.BASE_URL}${EXTERNAL_INDEX}`}
                title="Surfaces — le menu qu'un second appareil ouvre, et installe"
              >
                <Tablet className="h-4 w-4" /> Surfaces
              </a>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a
                href={pl8Url()}
                title="pl8 — la médiathèque : morceaux, samples, prises"
              >
                <Library className="h-4 w-4" /> pl8
              </a>
            </Button>
          </>
        }
      />

      {error && (
        <code className="mx-6 mt-3 overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      <ProjectsPane
        workspaces={workspaces}
        repos={repos}
        shares={shares}
        busy={busy}
        openWs={openWs}
        machine={machine ?? null}
        onOpen={open}
        onChanged={changed}
      />

      {/* La barre, en bas et sur toute la largeur — la même place et la même règle que dans
          l'éditeur : elle est là où l'on tape, donc elle est toujours là, et elle ne prend jamais
          le clavier d'elle-même (../../docs/commandBar.md). Ce qu'elle a dit tient au-dessus
          d'elle, refus en ambre, parce que ces verbes-là parlent à deux services et qu'un
          « ça n'a rien fait » silencieux est exactement ce qu'on évite. */}
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
                repos,
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
