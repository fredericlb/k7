// ProjectsPane.tsx — le corps de la page d'accueil : les espaces de travail de la machine, ou
// l'arborescence de celui qui est déplié. Détient l'asynchrone pour les deux vues
// présentationnelles à côté. Celui qui est ouvert vient de l'adresse (Home.tsx), pas d'un état
// local. Voir ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import type {
  FileNode,
  MachineWorkspace,
  RepoProject,
  RepoSummary,
  ShareSummary,
} from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { projects as api, engineMachine, projectHref } from "./api";
import { LibrariesCard } from "./LibrariesCard";
import {
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
  type Machine,
} from "./machine";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { SshKeyCard } from "./SshKeyCard";

export function ProjectsPane({
  workspaces,
  repos,
  shares,
  busy,
  openWs,
  machine,
  onOpen,
  onChanged,
}: {
  /** Ce que la machine tient, projets compris. La seule source : un projet est un dossier chez
   *  elle, et pl8 ne garde plus que le registre des dépôts. */
  workspaces: MachineWorkspace[];
  /**
   * Le registre de pl8 — pas une liste à dessiner, mais l'autre moitié de « cette adresse se
   * résout-elle ». `/<dépôt>/<projet>` passe par `by-name` chez pl8 ; une copie que la machine a
   * et que ce registre ignore s'ouvre par `@local`. Voir `projectHref` dans ./api.
   */
  repos: RepoSummary[];
  /**
   * Les instantanés gelés publiés par `project share link`. Poll de la page, chez pl8.
   *
   * La liste ENTIÈRE du compte, et pas une par projet : pl8 ne sait pas filtrer, et un appel par
   * rangée serait dix requêtes pour ce qu'un seul `GET /api/shares` rend déjà. Ce sont les
   * rangées qui découpent, avec `sharesOf`.
   */
  shares: ShareSummary[];
  busy: boolean;
  /** Le nom de l'espace de travail déplié, tiré de l'adresse, ou null pour la liste. */
  openWs: string | null;
  /**
   * La machine choisie, ou null si aucune n'est joignable.
   *
   * Elle ne sert plus seulement à écrire : c'est elle qui LIT la liste. Les projets sont ses
   * dossiers, et le miroir bare que pl8 tenait pour répondre à sa place était une deuxième copie
   * de ceux-ci — en retard d'un `git fetch`, et aveugle à un projet committé dont l'envoi n'était
   * pas passé. Voir ../../docs/projects.md.
   */
  machine: Machine | null;
  onOpen: (name: string | null) => void;
  /** À appeler après toute écriture, pour que la page recharge sans attendre le poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;
  // Le registre, par nom court. Une Map plutôt qu'un `find` par rangée : les deux listes sont
  // petites, mais celle-ci est relue à chaque rendu de chaque projet.
  const registry = useMemo(
    () => new Map(repos.map((r) => [r.name, r])),
    [repos],
  );
  const registered = useMemo(() => new Set(registry.keys()), [registry]);
  /** Le dépôt inscrit derrière un espace de travail, ou null — ce qui rend le retrait possible. */
  const repoFor = useCallback(
    (w: MachineWorkspace) => (w.repoName && registry.get(w.repoName)) || null,
    [registry],
  );

  /** Ce qui empêche d'écrire, en une phrase, ou "". Dit sur le bouton plutôt que découvert au
   *  clic. Sans machine la liste est vide de toute façon, mais la carte des bibliothèques, les
   *  partages et la clé restent utilisables — et le disent. */
  const blocked = machine
    ? ""
    : "aucune machine moteur joignable — un projet est un dossier sur la machine, et c'est elle qui les fait";

  /** La machine, ou un refus qui se lit. Les boutons sont déjà grisés sans elle ; arriver ici
   *  quand même veut dire qu'elle a disparu entre l'ouverture du dialogue et le clic. */
  const chosen = useCallback((): Machine => {
    if (!machine) throw new Error(blocked);
    return machine;
  }, [machine, blocked]);

  /**
   * Ajouter un dépôt, c'est l'inscrire chez pl8 PUIS le cloner ici.
   *
   * Les deux, et dans cet ordre. pl8 tient le registre — un dépôt appartient à une personne
   * plutôt qu'à une machine, et c'est ce qui permet à `/<dépôt>/<projet>` de se résoudre depuis
   * n'importe laquelle. Le clone est ce qui le fait APPARAÎTRE ici : cette page ne liste que ce
   * que la machine tient, alors sans lui l'ajout serait un formulaire qui ne change rien à
   * l'écran.
   */
  const add = useCallback(
    async (uri: string) => {
      setError(null);
      try {
        await api.add(uri);
        onChanged();
        await ensureWorkspace(chosen(), uri, (s) => setAdding(s));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAdding(null);
        onChanged();
      }
    },
    [chosen, onChanged],
  );

  const create = useCallback(
    async (
      w: MachineWorkspace,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { gripe } = await createProjectOnMachine(
        chosen(),
        w.name,
        folder,
        onStep,
        shape,
      );
      onChanged();
      // Le projet EXISTE sur la machine ; seul l'envoi a manqué. Lever ici garderait le
      // dialogue ouvert sur ce qui est en réalité un succès partiel, et inviterait à
      // recommencer une création qui a eu lieu.
      if (gripe) setError(`${folder} créé, mais : ${gripe}`);
    },
    [chosen, onChanged],
  );

  /**
   * Retirer un dépôt du registre de pl8 — et rien d'autre.
   *
   * La rangée ne disparaît PAS : elle montre un dossier que cette machine tient, et le retirer
   * d'une liste ne doit pas supprimer les fichiers de quelqu'un. Ce qui change est l'adresse —
   * `/<dépôt>/<projet>` ne se résout plus, donc les projets de cet espace passent à `@local` —
   * et le fait que ce dépôt ne sera plus proposé au clonage sur une autre machine.
   */
  const forgetRepo = useCallback(
    (r: RepoSummary) => {
      setError(null);
      void api
        .remove(r.id)
        .then(onChanged)
        .catch((e: Error) => setError(e.message));
    },
    [onChanged],
  );

  const removeProject = useCallback(
    async (
      w: MachineWorkspace,
      p: RepoProject,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await deleteProjectOnMachine(
        chosen(),
        w.name,
        p.path,
        onStep,
      );
      onChanged();
      if (gripe) setError(`${p.path} supprimé, mais : ${gripe}`);
    },
    [chosen, onChanged],
  );

  /**
   * L'arbre de l'espace déplié, lu sur la machine.
   *
   * Une seule demande, sans réessai : c'est un `readdir` sur un disque qui est là. La boucle qui
   * était ici attendait un miroir en cours de `git fetch` — un état qui n'existe plus, parce
   * qu'il n'y a plus de miroir.
   */
  useEffect(() => {
    if (!openWs || !machine) {
      setNodes(null);
      return;
    }
    let stop = false;
    setNodes(null);
    void engineMachine
      .workspaceTree(machine, openWs)
      .then((n) => {
        if (!stop) setNodes(n);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [openWs, machine]);

  // Le dépôt des bibliothèques passe AVANT tout le reste, arborescence comprise : c'est la
  // première chose à régler sur un compte neuf, et rien d'autre ici — ni un projet créé, ni un
  // projet ouvert — ne fonctionne tant qu'elle ne l'est pas.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <LibrariesCard />
      {ws ? (
        <RepoTree
          workspace={ws}
          nodes={nodes}
          onBack={() => onOpen(null)}
          projectHref={(path, app) =>
            projectHref(ws, { path, app }, registered)
          }
        />
      ) : (
        <>
          <RepoList
            workspaces={workspaces}
            busy={busy}
            error={error}
            adding={adding}
            hasMachine={machine !== null}
            onAdd={(uri) => void add(uri)}
            onOpen={(w) => onOpen(w.name)}
            blocked={blocked}
            onCreate={create}
            onDelete={removeProject}
            repoFor={repoFor}
            onForget={forgetRepo}
            // Même départ que depuis l'arborescence : l'adresse de l'application, pas une vue d'ici.
            projectHref={(w, p) => projectHref(w, p, registered)}
            // Les partages SORTENT d'un projet : ils sont à sa rangée, derrière un bouton, et
            // non dans une carte du bas qui mélangeait ceux de tous les projets du compte.
            shares={shares}
            onChanged={onChanged}
          />
          {/* La clé de déploiement reste tout en bas : réglée une fois, sur le compte. */}
          <div className="mt-auto">
            <SshKeyCard />
          </div>
        </>
      )}
    </div>
  );
}
