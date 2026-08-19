// Home.tsx — ce que l8 dessine quand son adresse ne nomme AUCUN projet : les dépôts, les
// projets qu'ils contiennent, les bibliothèques, les partages, la clé. Détient l'asynchrone —
// l'identité, la machine, et les deux polls — pour le corps présentationnel à côté. Aucun
// moteur n'est exigé : la page se lit sans, seuls créer et supprimer s'en servent.
// Voir ../../docs/projects.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import type { RepoSummary, ShareSummary } from "@studio/web-protocol";
import { Library, RefreshCw, Server, ServerOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, engines } from "../api";
import { mediatekUrl, projects, shares as sharesApi } from "./api";
import type { Machine } from "./machine";
import { ProjectsPane } from "./ProjectsPane";

/** Le même que celui de la médiathèque : assez vif pour qu'un `git fetch` qui se termine se
 *  voie, assez lent pour n'être rien du tout sur une liste de dix lignes. */
const POLL_MS = 3000;

/**
 * Le dépôt ouvert voyage dans la QUERY, pas dans le chemin.
 *
 * Le chemin appartient au lancement : `/l8/<dépôt>/<projet>` est lu par `parseLaunch` avant que
 * quoi que ce soit ne soit monté, et il n'y a pas de segment qu'on pourrait ajouter ici sans
 * qu'il se lise comme le nom d'un dépôt à ouvrir. La query, elle, est exactement ce qu'un
 * routeur de SPA possède — c'est l'argument de packages/project-shell/docs/launch.md, pris dans
 * l'autre sens. Et elle se met en signet, se recopie et répond au bouton « précédent ».
 */
const REPO_PARAM = "repo";

export function Home() {
  const [params, setParams] = useSearchParams();
  const openId = params.get(REPO_PARAM);

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
   * ce que le commentaire de `EngineGate` sur `claimProject` interdisait quand `/l8/` n'était
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

  // Ce qui a été chargé la dernière fois, par service. Un jeton dit « à jour », pas « en main » —
  // c'est pourquoi il n'est posé qu'après que la liste l'est. Voir ../../docs/projects.md.
  const seen = useRef<{ repos: string; shares: string }>({
    repos: "",
    shares: "",
  });

  const loadRepos = useCallback(async (rev: string) => {
    try {
      const { repos: list } = await projects.list();
      seen.current.repos = rev;
      setRepos(list);
      setError(null);
    } catch (e) {
      // Ici, contrairement à la médiathèque, les dépôts SONT le sujet de l'écran : leur service
      // en panne se dit, plutôt que de laisser une liste vide qui ressemble à un compte neuf.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadShares = useCallback(async (rev: string) => {
    try {
      const r = await sharesApi.list();
      seen.current.shares = rev;
      setShares(r.shares);
    } catch {
      /* la carte reste sur ce qu'elle tenait, et le dit elle-même */
    }
  }, []);

  /** Tout relire au prochain tick, sans attendre qu'une révision bouge : après une écriture
   *  d'ici, on sait déjà que la liste a changé. */
  const changed = useCallback(() => {
    seen.current = { repos: "", shares: "" };
  }, []);

  // Un seul minuteur pour les deux, là où la médiathèque en tenait deux : ici les dépôts et les
  // partages sont le MÊME écran et viennent du même service. Ce qui justifiait la séparation
  // là-bas — ne pas faire dépendre le catalogue d'un `git fetch` qui traîne — n'a plus d'objet.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await projects.revision();
        if (stop) return;
        if (seen.current.repos !== revision) await loadRepos(revision);
      } catch (e) {
        if (!stop) {
          setError((e as Error).message);
          setBusy(false);
        }
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

  /** Ouvrir l'arborescence d'un dépôt, ou revenir à la liste. `replace` : parcourir des dépôts
   *  n'est pas une navigation dont on veut dix entrées dans l'historique du bouton « retour ». */
  const open = useCallback(
    (id: string | null) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set(REPO_PARAM, id);
          else next.delete(REPO_PARAM);
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
        title="l8"
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
                  ? `Les projets sont créés et supprimés sur ${machine.fileBase}`
                  : "Aucune machine moteur joignable — la liste se lit quand même"
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
            {/* Le catalogue est ce dont un projet SE SERT : il est à un lien, pas devant.
                DANS le même onglet, à l'inverse du lien qui vient d'en face : là-bas la
                médiathèque joue quelque chose et partir l'arrêterait (apps/st0/docs/miniPlayer.md),
                ici rien ne tourne — cette page est une liste, et on y revient par « précédent »
                avec l'arbre replié pour tout dommage. */}
            <Button variant="secondary" size="sm" asChild>
              <a href={mediatekUrl()}>
                <Library className="h-4 w-4" /> Médiathèque
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
        repos={repos}
        shares={shares}
        busy={busy}
        openId={openId}
        machine={machine ?? null}
        onOpen={open}
        onChanged={changed}
      />
    </div>
  );
}
