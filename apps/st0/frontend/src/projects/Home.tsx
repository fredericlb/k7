// Home.tsx — ce que st0 dessine quand son adresse ne nomme AUCUN projet : les espaces de travail
// de la machine et les projets dedans, les bibliothèques, les partages, la clé. Détient
// l'asynchrone — l'identité, la machine, et les deux polls — pour le corps présentationnel à
// côté. La liste des projets vient de la MACHINE et exige donc qu'il y en ait une ; le reste de
// l'écran se lit sans. Voir ../../docs/projects.md.

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

/** Le même que celui de la médiathèque : assez vif pour qu'un `git fetch` qui se termine se
 *  voie, assez lent pour n'être rien du tout sur une liste de dix lignes. */
const POLL_MS = 3000;

/**
 * L'espace de travail ouvert voyage dans la QUERY, pas dans le chemin.
 *
 * Le chemin appartient au lancement : `/<dépôt>/<projet>` est lu par `parseLaunch` avant que
 * quoi que ce soit ne soit monté, et il n'y a pas de segment qu'on pourrait ajouter ici sans
 * qu'il se lise comme le nom d'un dépôt à ouvrir. La query, elle, est exactement ce qu'un
 * routeur de SPA possède — c'est l'argument de packages/project-shell/docs/launch.md, pris dans
 * l'autre sens. Et elle se met en signet, se recopie et répond au bouton « précédent ».
 *
 * C'était `?repo=<id>`, un identifiant de dépôt chez pl8. Ce qu'on déplie est un dossier sur la
 * MACHINE désormais, et son nom est ce qui le désigne — lisible, en plus, ce que le hachage
 * n'était pas.
 */
const WS_PARAM = "ws";

export function Home() {
  const [params, setParams] = useSearchParams();
  const openWs = params.get(WS_PARAM);

  const [workspaces, setWorkspaces] = useState<MachineWorkspace[]>([]);
  // Le registre de pl8 — pas une liste à dessiner, mais ce qui décide si l'adresse portable
  // d'un espace de travail se résout. Voir `projectHref` dans ./api.
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // La machine choisie, ou null. `undefined` tant qu'on n'a pas encore sondé : la différence
  // compte, parce que « pas de machine » est un refus qu'on affiche et « on cherche » ne l'est pas.
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [probing, setProbing] = useState(false);

  /**
   * L'identité, puis la machine.
   *
   * Dans cet ordre et pas en parallèle : le service de fichiers fait confiance à l'en-tête
   * `USER_HEADER` (confiance locale, phase 2), donc une machine sans personne à nommer est une
   * machine avec laquelle on ne peut rien faire — autant ne pas la retenir.
   *
   * `find()` et RIEN d'autre : surtout pas `hold()`. Une revendication est un bail SUR UN
   * PROJET, et cette page n'en a aucun — la prendre déloge l'onglet de quelqu'un qui joue son
   * morceau sur ce moteur, depuis un écran qui ne fait que lister des dépôts. C'est exactement
   * ce que le commentaire de `EngineGate` sur `claimProject` interdisait quand `/` n'était
   * qu'une redirection ; maintenant que c'est un écran, c'est ici que ça se tient.
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
      // Une sonde ratée n'est pas une panne de cette page : elle en garde juste les deux
      // boutons gris, ce qui est déjà dit à l'endroit où on cliquerait.
      setMachine(null);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // Ce qui a été chargé au dernier passage, par service. Un jeton dit « à jour », pas « en
  // main » — c'est pourquoi il n'est posé qu'après que la liste l'est. Voir ../../docs/projects.md.
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
      /* la carte reste sur ce qu'elle tenait, et le dit elle-même */
    }
  }, []);

  const loadRepos = useCallback(async (rev: string) => {
    try {
      const { repos: list } = await projects.list();
      seen.current.repos = rev;
      setRepos(list);
    } catch {
      /* le registre n'est plus le sujet de l'écran : son absence se lit sur les rangées */
    }
  }, []);

  /** Tout relire au prochain tick, sans attendre qu'une révision bouge : après une écriture
   *  d'ici, on sait déjà que la liste a changé. */
  const changed = useCallback(() => {
    seen.current = { repos: "", shares: "" };
  }, []);

  /**
   * La liste des projets vient de la MACHINE, et d'elle seule.
   *
   * Pas de jeton de révision devant, contrairement aux partages : le service de fichiers répond
   * la liste elle-même, derrière une fenêtre de cinq secondes de son côté, et demander d'abord
   * si elle a bougé serait un aller-retour de plus pour économiser un readdir déjà mémoïsé.
   *
   * Sans machine, il n'y a rien à demander — et rien à afficher non plus. C'est le prix de ce
   * déménagement, dit ici parce que c'est ici qu'il se paie : les projets sont des dossiers sur
   * cette machine, donc c'est elle qui sait lesquels existent. Le reste de l'écran — la clé, les
   * partages, les bibliothèques — se lit toujours sans elle.
   */
  const loadWorkspaces = useCallback(async (m: Machine) => {
    try {
      setWorkspaces(await engineMachine.workspaces(m));
      setError(null);
    } catch (e) {
      // La machine est le sujet de l'écran maintenant : sa panne se dit, plutôt que de laisser
      // une liste vide qui ressemble à un compte neuf.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (machine === undefined) return; // on sonde encore : ni liste ni refus
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
   * Ce que pl8 tient encore, et pourquoi cet écran le demande toujours : le REGISTRE des dépôts
   * et les partages.
   *
   * Le registre n'est plus une liste à dessiner — c'est la machine qui dit ce qui existe — mais
   * il reste ce qui rend une adresse `/<dépôt>/<projet>` résoluble : `by-name` est demandé chez
   * pl8 un clic plus tard. Une copie que la machine a et que ce registre ignore s'ouvre donc par
   * `@local` et pas autrement, et c'est en croisant les deux que la rangée le sait.
   *
   * Les partages, eux, sont ses octets, servis à des gens sans compte : rien de tout ça n'est
   * sur une machine. Un seul minuteur pour les deux — même service, même écran.
   */
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await projects.revision();
        if (!stop && seen.current.repos !== revision) await loadRepos(revision);
      } catch {
        /* la rangée le dit elle-même */
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

  /**
   * La barre de commande de cet écran, et sa ligne d'état.
   *
   * Elle a son propre vocabulaire (`homeCommands.ts`) et pas celui de l'éditeur : ici il n'y a ni
   * projet ouvert, ni session moteur, ni fichier — `LOCAL_COMMANDS` serait un catalogue de choses
   * qu'on ne peut pas faire. Six verbes, ceux des boutons de la page.
   */
  const cmdRef = useRef<CommandBarHandle>(null);
  const { locale } = useLocale();
  const palette = useMemo(() => buildHomePalette(locale), [locale]);
  const [said, setSaid] = useState<{ text: string; refused: boolean } | null>(
    null,
  );
  /** Le projet qu'un `project delete init` a désigné, en attente de son confirm. Une ref : elle
   *  est lue par la commande suivante et jamais dessinée. */
  const armed = useRef<ArmedDelete | null>(null);

  /** Tout relire MAINTENANT après une écriture d'ici : la liste de la machine ne bouge sinon
   *  qu'au prochain tick, et un projet qu'on vient de créer se ferait attendre trois secondes. */
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
      // Une ligne que cet écran ne connaît pas est refusée ICI : il n'y a pas de service derrière
      // à qui la passer, contrairement à l'éditeur, dont la barre finit chez `/command`.
      if (!known)
        setSaid({
          text: `« ${line.trim()} » n'est pas une commande de cet écran`,
          refused: true,
        });
    },
    [machine, workspaces, repos, openWs, reread],
  );

  /**
   * Deux Shift seuls pour lui donner le clavier — le même geste que dans l'éditeur.
   *
   * Le seul raccourci de cet écran, et il ne peut pas être autre chose : la barre ne prend jamais
   * le clavier d'elle-même, donc sans lui on ne l'atteindrait qu'à la souris. `e.repeat` écarte un
   * Shift maintenu, et la branche est inatteignable depuis la barre elle-même, qui est un champ
   * de saisie.
   */
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

  /** Déplier un espace de travail, ou revenir à la liste. `replace` : en parcourir trois pour
   *  voir ce qu'il y a dedans n'est pas une navigation dont on veut trois entrées dans
   *  l'historique du bouton « retour ». */
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
            // Tout ce qu'un champ peut proposer est déjà sur cet écran — il interroge les deux
            // services en boucle — donc la réponse est immédiate là où celle de l'éditeur est un
            // aller-retour. La promesse est la même : le vocabulaire complet, une fois par champ.
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
