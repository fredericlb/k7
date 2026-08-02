// WorkspaceSelect.tsx — pick which workspace to open (a folder under the engine's
// ~/.lanes/root/<you>/). Presentational, like EngineSelect: the gate owns the
// async, this renders the list + a "new workspace" action + a "clone via SSH" one.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import type { WorkspaceSummary } from "../types";

// "git@host:me/repo.git" / "ssh://host/me/repo.git" -> "repo", for the default name.
function nameFromUri(uri: string): string {
  const last = uri.split(/[/:]/).filter(Boolean).pop() ?? "";
  return last.replace(/\.git$/, "");
}

export function WorkspaceSelect({
  workspaces,
  loading,
  cloning,
  cloneError,
  onRefresh,
  onPick,
  onCreate,
  onClone,
  onShowSshKey,
}: {
  workspaces: WorkspaceSummary[];
  loading: boolean;
  cloning: boolean;
  cloneError: string | null;
  onRefresh: () => void;
  onPick: (name: string) => void;
  onCreate: (name: string) => void;
  onClone: (name: string, uri: string) => void;
  onShowSshKey: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [cloneUri, setCloneUri] = useState("");
  // The clone's workspace name follows the repo name until the user edits it.
  const [cloneName, setCloneName] = useState("");
  const [cloneNameEdited, setCloneNameEdited] = useState(false);
  const create = () => {
    const n = newName.trim();
    if (n) {
      onCreate(n);
      setNewName("");
    }
  };
  const clone = () => {
    const uri = cloneUri.trim();
    const name = cloneName.trim();
    if (uri && name && !cloning) onClone(name, uri);
  };
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FolderOpen className="h-5 w-5" /> {m["workspaces.title"]()}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onShowSshKey}>
              <KeyRound className="h-4 w-4" /> {m["workspaces.sshKey"]()}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw
                className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
              {m["common.refresh"]()}
            </Button>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {m["common.loading"]()}
              </span>
            ) : (
              <>{m["workspaces.empty"]()}</>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {workspaces.map((w) => (
              <li
                key={w.name}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{w.name}</span>
                    <Badge variant={w.isSingleProject ? "tag" : "default"}>
                      {w.isSingleProject
                        ? "project"
                        : `${w.projectCount} project${w.projectCount === 1 ? "" : "s"}`}
                    </Badge>
                  </div>
                </div>
                <Button size="sm" onClick={() => onPick(w.name)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["workspaces.namePlaceholder"]()}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={create}
            disabled={!newName.trim()}
          >
            <Plus className="h-4 w-4" /> {m["workspaces.create"]()}
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4" /> {m["workspaces.cloneTitle"]()}
          </div>
          <input
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["workspaces.cloneUriPlaceholder"]()}
            value={cloneUri}
            onChange={(e) => {
              setCloneUri(e.target.value);
              if (!cloneNameEdited) setCloneName(nameFromUri(e.target.value));
            }}
            onKeyDown={(e) => e.key === "Enter" && clone()}
          />
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
              placeholder={m["workspaces.namePlaceholder"]()}
              value={cloneName}
              onChange={(e) => {
                setCloneName(e.target.value);
                setCloneNameEdited(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && clone()}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={clone}
              disabled={cloning || !cloneUri.trim() || !cloneName.trim()}
            >
              {cloning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />{" "}
                  {m["workspaces.cloning"]()}
                </>
              ) : (
                <>
                  <GitBranch className="h-4 w-4" /> {m["workspaces.clone"]()}
                </>
              )}
            </Button>
          </div>
          {cloneError && (
            <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
              {cloneError}
            </code>
          )}
        </div>
      </div>
    </div>
  );
}
