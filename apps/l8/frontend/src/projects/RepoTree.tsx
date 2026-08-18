// RepoTree.tsx — l'arborescence d'un dépôt, telle que le miroir la lit, avec un bouton
// « Ouvrir dans l8 » sur chaque dossier qui est un projet. Lecture seule : st0 ne fait pas de
// copie de travail, il n'y a donc rien à écrire ici. Voir ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import type { FileNode, RepoSummary } from "@studio/web-protocol";
import type { ProjectApp } from "@studio/web-protocol/projects";
import { sortNodes } from "@studio/web-protocol/tree";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  FolderGit2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function Row({
  node,
  depth,
  open,
  onToggle,
  projectHref,
}: {
  node: FileNode;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  projectHref: (path: string, app: ProjectApp) => string;
}) {
  const isOpen = open.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };
  if (!node.dir)
    return (
      <div
        className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground"
        style={pad}
      >
        <File className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  return (
    <>
      <div className="flex items-center gap-2 py-0.5 text-sm" style={pad}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground"
          onClick={() => onToggle(node.path)}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          {node.project ? (
            <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 opacity-60" />
          )}
          <span className={node.project ? "truncate font-medium" : "truncate"}>
            {node.name}
          </span>
        </button>
        {/* Le seul départ de tout l'écran : un projet s'ouvre dans SON application, pas ici, et
            c'est le suffixe du dossier qui la nomme (packages/web-protocol/projects.ts). Une
            ancre et un nouvel onglet, pour les raisons de ../../docs/projects.md. */}
        {node.app && (
          <Button size="sm" variant="secondary" asChild>
            <a
              href={projectHref(node.path, node.app)}
              target="_blank"
              rel="noopener"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Ouvrir dans {node.app}
            </a>
          </Button>
        )}
      </div>
      {isOpen &&
        node.children?.map((c) => (
          <Row
            key={c.path}
            node={c}
            depth={depth + 1}
            open={open}
            onToggle={onToggle}
            projectHref={projectHref}
          />
        ))}
    </>
  );
}

export function RepoTree({
  repo,
  nodes,
  onBack,
  onRefresh,
  projectHref,
}: {
  repo: RepoSummary;
  /** null tant que le miroir n'a rien à lire — ce n'est pas un dépôt vide. */
  nodes: FileNode[] | null;
  onBack: () => void;
  onRefresh: () => void;
  /** L'adresse d'un projet, pas l'action de l'ouvrir : la rangée en fait un vrai lien. */
  projectHref: (path: string, app: ProjectApp) => string;
}) {
  // L'ordre de lecture, à tous les niveaux : le miroir répond dans celui de l'arbre git.
  const rows = useMemo(() => (nodes ? sortNodes(nodes) : null), [nodes]);
  // Les dossiers dépliés au départ : ceux qu'il faut traverser pour voir un projet seraient
  // le bon calcul ; le premier niveau suffit, et un dépôt qui s'ouvre tout replié cache
  // derrière un clic la seule chose qu'on vient y chercher.
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Une seule fois par dépôt, à l'arrivée de l'arbre : ensuite les plis sont ceux de la
  // personne, y compris ceux qu'elle a refermés — un rafraîchissement ne les rouvre pas.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!rows || seeded.current === repo.id) return;
    seeded.current = repo.id;
    setOpen(new Set(rows.filter((n) => n.dir).map((n) => n.path)));
  }, [rows, repo.id]);
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Dépôts
        </Button>
        <span className="truncate font-medium">{repo.label}</span>
        <span className="truncate text-xs text-muted-foreground">
          {repo.uri}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={repo.fetching}
          >
            <RefreshCw
              className={repo.fetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2">
        {rows === null ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Récupération du dépôt…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Ce dépôt est vide.
          </div>
        ) : (
          rows.map((n) => (
            <Row
              key={n.path}
              node={n}
              depth={0}
              open={open}
              onToggle={toggle}
              projectHref={projectHref}
            />
          ))
        )}
      </div>
    </div>
  );
}
