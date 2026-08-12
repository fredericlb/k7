// ProjectsSection.tsx — la section Projets : la liste des dépôts, ou l'arborescence de celui
// qui est ouvert. Détient l'asynchrone pour les deux vues présentationnelles à côté. Le dépôt
// ouvert vient de l'URL (routes.ts), pas d'un état local. Voir ../../docs/projects.md.

import type { ProjectShape } from "@studio/song/yaml/projectSchema";
import type { FileNode, RepoProject, RepoSummary } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { projects as api } from "../api";
import {
  createProjectOnMachine,
  deleteProjectOnMachine,
  type Machine,
} from "./machine";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { SshKeyCard } from "./SshKeyCard";

export function ProjectsSection({
  repos,
  busy,
  openId,
  machine,
  onOpen,
  onChanged,
}: {
  repos: RepoSummary[];
  busy: boolean;
  /** L'id du dépôt ouvert, tiré de l'adresse, ou null pour la liste. */
  openId: string | null;
  /**
   * La machine choisie, ou null si aucune n'est joignable.
   *
   * Créer et supprimer un projet passent OBLIGATOIREMENT par elle : st0 ne tient qu'un miroir
   * bare, sans blobs et balayé au bout de quinze jours — la copie qu'on committe vit là-bas, et
   * le file-service sait déjà l'échafauder, la supprimer et la pousser. Voir ../../docs/projects.md.
   */
  machine: { fileBase: string | null; token: string | null };
  onOpen: (id: string | null) => void;
  /** À appeler après toute écriture, pour que la section recharge sans attendre le poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const repo = repos.find((r) => r.id === openId) ?? null;

  const add = useCallback(
    (uri: string) => {
      setError(null);
      void api
        .add(uri)
        .then(onChanged)
        .catch((e: Error) => setError(e.message));
    },
    [onChanged],
  );

  const remove = useCallback(
    (r: RepoSummary) => {
      setError(null);
      void api
        .remove(r.id)
        .then(() => {
          if (r.id === openId) onOpen(null);
          onChanged();
        })
        .catch((e: Error) => setError(e.message));
    },
    [onChanged, onOpen, openId],
  );

  const refresh = useCallback(
    (r: RepoSummary) => {
      setError(null);
      void api
        .refresh(r.id)
        .then(onChanged)
        .catch((e: Error) => setError(e.message));
    },
    [onChanged],
  );

  /** Ce qui empêche d'écrire, en une phrase, ou "". Dit sur le bouton plutôt que découvert au
   *  clic : n'avoir aucune machine joignable est un état ordinaire de cette page, qui elle
   *  fonctionne parfaitement sans. */
  const blocked =
    machine.fileBase && machine.token
      ? ""
      : "aucune machine moteur joignable — créer ou supprimer un projet se fait sur la machine, pas ici";

  /** Le miroir de st0 ne verra le changement qu'après un `git fetch`, et le poll n'en fait un
   *  qu'au plus toutes les dix minutes. On le demande donc explicitement, sinon la liste
   *  resterait telle quelle et le clic aurait l'air de n'avoir rien fait. */
  const reread = useCallback(
    async (r: RepoSummary) => {
      await api.refresh(r.id).catch(() => {});
      onChanged();
    },
    [onChanged],
  );

  /** La machine, ou un refus qui se lit. Les boutons sont déjà grisés sans elle ; arriver ici
   *  quand même veut dire qu'elle a disparu entre l'ouverture du dialogue et le clic. */
  const chosen = useCallback((): Machine => {
    const { fileBase, token } = machine;
    if (!fileBase || !token) throw new Error(blocked);
    return { fileBase, token };
  }, [machine, blocked]);

  const create = useCallback(
    async (
      r: RepoSummary,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { gripe } = await createProjectOnMachine(
        chosen(),
        r.uri,
        folder,
        onStep,
        shape,
      );
      await reread(r);
      // Le projet EXISTE sur la machine ; seul l'envoi a manqué. Lever ici garderait le
      // dialogue ouvert sur ce qui est en réalité un succès partiel, et inviterait à
      // recommencer une création qui a eu lieu.
      if (gripe) setError(`${folder} créé, mais : ${gripe}`);
    },
    [chosen, reread],
  );

  const removeProject = useCallback(
    async (r: RepoSummary, p: RepoProject, onStep: (s: string) => void) => {
      const { gripe } = await deleteProjectOnMachine(
        chosen(),
        r.uri,
        p.path,
        onStep,
      );
      await reread(r);
      if (gripe) setError(`${p.path} supprimé, mais : ${gripe}`);
    },
    [chosen, reread],
  );

  // L'arbre du dépôt ouvert. `null` en réponse veut dire « connu, miroir en cours » — on
  // redemande, plutôt que d'afficher un dépôt vide qui n'en est pas un.
  useEffect(() => {
    if (!openId) {
      setNodes(null);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void api
        .tree(openId)
        .then((r) => {
          if (stop) return;
          if (!r) {
            timer = setTimeout(tick, 700);
            return;
          }
          setNodes(r.nodes);
        })
        .catch((e: Error) => {
          if (!stop) setError(e.message);
        });
    };
    setNodes(null);
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // `repo?.fetching` est là exprès : un rafraîchissement qui se termine doit relire l'arbre.
  }, [openId, repo?.fetching]);

  if (repo)
    return (
      <RepoTree
        repo={repo}
        nodes={nodes}
        onBack={() => onOpen(null)}
        onRefresh={() => refresh(repo)}
        projectHref={(path, app) => api.openIn(repo.name, path, app)}
      />
    );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <RepoList
        repos={repos}
        busy={busy}
        error={error}
        onAdd={add}
        onOpen={(r) => onOpen(r.id)}
        blocked={blocked}
        onCreate={create}
        onDelete={removeProject}
        // Même départ que depuis l'arborescence : l'adresse de l'application, pas une vue d'ici.
        projectHref={(r, p) => api.openIn(r.name, p.path, p.app)}
        onRemove={remove}
        onRefresh={refresh}
      />
      <div className="mt-auto">
        <SshKeyCard />
      </div>
    </div>
  );
}
