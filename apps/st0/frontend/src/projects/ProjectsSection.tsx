// ProjectsSection.tsx — la section Projets : la liste des dépôts, ou l'arborescence de celui
// qui est ouvert. Détient l'asynchrone pour les deux vues présentationnelles à côté. Le dépôt
// ouvert vient de l'URL (routes.ts), pas d'un état local. Voir ../../docs/projects.md.

import type { FileNode, RepoSummary } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { projects as api } from "../api";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { SshKeyCard } from "./SshKeyCard";

export function ProjectsSection({
  repos,
  busy,
  openId,
  onOpen,
  onChanged,
}: {
  repos: RepoSummary[];
  busy: boolean;
  /** L'id du dépôt ouvert, tiré de l'adresse, ou null pour la liste. */
  openId: string | null;
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
        onOpenProject={(path, app) => {
          window.location.href = api.openIn(repo.uri, path, app);
        }}
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
        // Même départ que depuis l'arborescence : l'adresse de l'application, pas une vue d'ici.
        onOpenProject={(r, p) => {
          window.location.href = api.openIn(r.uri, p.path, p.app);
        }}
        onRemove={remove}
        onRefresh={refresh}
      />
      <div className="mt-auto">
        <SshKeyCard />
      </div>
    </div>
  );
}
