// LibrariesCard.tsx — the libraries repository: the modules and chains EVERY project on the
// account inherits, mounted in each workspace as a git submodule. At the head of the section
// because nothing below it works first: no project opens without one, and no workspace is made
// or imported either. Adding one CLONES it, which is what says the URI is a repository — so the
// button waits, and what it leaves is the clone the bench opens against.
// See packages/song/docs/sharedFolders.md and packages/file-service/docs/libraries.md.

import { Button } from "@frediverse/ui/button";
import {
  LibraryBig,
  Loader2,
  Pencil,
  TriangleAlert,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { RepoRef } from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { accountFiles } from "./api";
import type { AccountFiles } from "./workspaceOps";

export function LibrariesCard({
  fileService,
  onRepo,
}: {
  fileService: AccountFiles | null;
  /** Reported UP because it decides more than this card: with no library, no workspace may be made either. */
  onRepo?: (repo: RepoRef | null) => void;
}) {
  // `undefined` = not read yet, `null` = read and there is none: a new account must read 'you need one', not a loading blank.
  const [repo, setRepo] = useState<RepoRef | null | undefined>(undefined);
  const [uri, setUri] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The file service holds it, so there is nothing to read until it answers.
    if (!fileService) return setRepo(null);
    void accountFiles
      .libraries(fileService)
      .then(setRepo)
      .catch((e: Error) => {
        setError(e.message);
        setRepo(null);
      });
  }, [fileService]);

  // Announced UP from the state and not from each setter: what this card holds is the one answer,
  // and it decides more than this card — with no library, no workspace may be made either.
  useEffect(() => {
    if (repo !== undefined) onRepo?.(repo);
  }, [repo, onRepo]);

  const save = () => {
    const v = uri.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    if (!fileService) return setError(m["libs.noFiles"]());
    void accountFiles
      .setLibraries(fileService, v)
      .then((r) => {
        setRepo(r);
        setUri("");
        setEditing(false);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (repo === undefined)
    return (
      <div className="flex items-center gap-2 border-b px-6 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m["libs.reading"]()}
      </div>
    );

  const missing = !repo;
  const form = missing || editing;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-6 py-4",
        // With no repository the card is not an information row: it is the one thing to do here, and nothing else works until it is done.
        missing && "border-b-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {missing ? (
          <TriangleAlert className="h-4 w-4 text-amber-500" />
        ) : (
          <LibraryBig className="h-4 w-4" />
        )}
        {m["libs.title"]()}
        {!missing && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setUri(repo.uri);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> {m["libs.change"]()}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {missing
          ? parts((h) => m["libs.missingBody"](h), {
              need: <b>{m["libs.needOne"]()}</b>,
              ref: <code>@st0/…</code>,
              empty: <b>{m["libs.emptyWord"]()}</b>,
            })
          : m["libs.haveBody"]()}
      </p>

      {form ? (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["libs.placeholder"]()}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <Button size="sm" onClick={save} disabled={busy || !uri.trim()}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {/* The wait is a CLONE, so the button says so rather than looking stuck on 'Add'. */}
            {busy
              ? m["libs.cloning"]()
              : missing
                ? m["libs.add"]()
                : m["libs.replace"]()}
          </Button>
          {editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false);
                setUri("");
              }}
            >
              {m["common.cancel"]()}
            </Button>
          )}
        </div>
      ) : (
        <code className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
          {repo.uri}
        </code>
      )}

      {/* Changing the repository touches NO workspace: a submodule already cloned into a workspace still points at the old one. */}
      {editing && !missing && (
        <p className="text-xs text-amber-500">{m["libs.changeWarning"]()}</p>
      )}

      {error && (
        <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}
    </div>
  );
}
