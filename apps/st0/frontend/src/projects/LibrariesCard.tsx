// LibrariesCard.tsx — the origin's libraries: the named repositories of modules and chains EVERY
// project inherits, one list for all accounts, cloned ONCE by the server with its own key. Only an
// admin sees the add, remove and update controls, the server's key, and each row's Bench — the
// one place that library is edited; the hub refuses anyone else's write anyway, so hiding them is
// courtesy, not the gate. Adding one CLONES it, which is what says the URI is a repository.
// See packages/song/docs/sharedFolders.md and packages/file-service/docs/libraries.md.

import { Button } from "@frediverse/ui/button";
import {
  Hammer,
  LibraryBig,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type {
  AccountLibrariesReply,
  AccountLibrary,
} from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { runGit } from "../components/GitBusy";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { accountFiles, libraryBenchHref } from "./api";
import type { AccountFiles } from "./workspaceOps";

/** What a call did to a library, when it is worth reading: kept work, a failure — never "up to date". */
const worthSaying = (r: AccountLibrariesReply): string[] =>
  (r.notes ?? [])
    .filter((n) => n.state === "kept" || n.state === "failed")
    .map((n) => `${n.name}: ${n.note}`);

export function LibrariesCard({
  fileService,
  onLibraries,
}: {
  fileService: AccountFiles | null;
  /** Reported UP because it decides more than this card: with no library, no workspace may be made either. */
  onLibraries?: (libraries: AccountLibrary[]) => void;
}) {
  // `undefined` = not read yet, `[]` = read and there is none: a new account must read 'you need one', not a loading blank.
  const [libraries, setLibraries] = useState<AccountLibrary[] | undefined>(
    undefined,
  );
  const [uri, setUri] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"add" | "update" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [serverKey, setServerKey] = useState<string | null>(null);

  // The key each library repository must accept, read-only: an admin cannot add one without it.
  useEffect(() => {
    if (!fileService?.admin) return;
    void accountFiles
      .librariesKey(fileService)
      .then((r) => setServerKey(r.publicKey))
      .catch(() => setServerKey(null));
  }, [fileService]);

  useEffect(() => {
    // The file service holds them, so there is nothing to read until it answers.
    if (!fileService) return setLibraries([]);
    void accountFiles
      .libraries(fileService)
      .then((r) => setLibraries(r.libraries))
      .catch((e: Error) => {
        setError(e.message);
        setLibraries([]);
      });
  }, [fileService]);

  // Announced UP from the state and not from each setter: what this card holds is the one answer.
  useEffect(() => {
    if (libraries !== undefined) onLibraries?.(libraries);
  }, [libraries, onLibraries]);

  /** Run one call, and take the list and anything worth reading from its answer. */
  const run = (what: string, call: () => Promise<AccountLibrariesReply>) => {
    setBusy(what);
    setError(null);
    setNotes([]);
    // Adding, removing and updating a library all clone or pull: the page waits for git.
    void runGit(m["git.libraries"](), call)
      .then((r) => {
        setLibraries(r.libraries);
        setNotes(worthSaying(r));
        if (what === "add") {
          setUri("");
          setName("");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const listed = (libraries ?? []).map(({ name, uri }) => ({ name, uri }));

  const add = () => {
    const v = uri.trim();
    if (!v) return;
    if (!fileService) return setError(m["libs.noFiles"]());
    const n = name.trim();
    run("add", () =>
      accountFiles.setLibraries(fileService, [
        ...listed,
        n ? { name: n, uri: v } : { uri: v },
      ]),
    );
  };

  const remove = (gone: string) => {
    if (!fileService) return setError(m["libs.noFiles"]());
    run(gone, () =>
      accountFiles.setLibraries(
        fileService,
        listed.filter((l) => l.name !== gone),
      ),
    );
  };

  const update = () => {
    if (!fileService) return setError(m["libs.noFiles"]());
    run("update", () => accountFiles.updateLibraries(fileService));
  };

  if (libraries === undefined)
    return (
      <div className="flex items-center gap-2 border-b px-6 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {m["libs.reading"]()}
      </div>
    );

  const missing = !libraries.length;
  const canEdit = fileService?.admin === true;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-6 py-4",
        // With no library the card is not an information row: it is the one thing to do here, and nothing else works until it is done.
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
        {!missing && canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={update}
            disabled={busy !== null}
          >
            {busy === "update" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}{" "}
            {busy === "update" ? m["libs.updating"]() : m["libs.update"]()}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {missing && !canEdit
          ? m["libs.missingAskAdmin"]()
          : missing
            ? parts((h) => m["libs.missingBody"](h), {
                need: <b>{m["libs.needOne"]()}</b>,
                ref: <code>@st0/…</code>,
                empty: <b>{m["libs.emptyWord"]()}</b>,
              })
            : m["libs.haveBody"]()}
      </p>
      {!canEdit && (
        <p className="text-xs text-muted-foreground">{m["libs.adminOnly"]()}</p>
      )}

      {libraries.map((l) => (
        <div key={l.name} className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2">
            <code className="shrink-0 font-semibold">@{l.name}</code>
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1">
              {l.uri}
            </code>
            {!l.cloned && (
              <span className="shrink-0 text-amber-500">
                {l.error ? m["libs.failed"]() : m["libs.notCloned"]()}
              </span>
            )}
            {/* The bench is where a library is EDITED, in a clone of its own — an <a>, since it opens a project. */}
            {canEdit && l.cloned && (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={libraryBenchHref(l.name)}
                  title={m["libs.benchHint"]()}
                >
                  <Hammer className="h-3.5 w-3.5" /> {m["libs.bench"]()}
                </a>
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                title={m["libs.remove"]()}
                onClick={() => remove(l.name)}
                disabled={busy !== null}
              >
                {busy === l.name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
          {l.error && (
            <code className="overflow-x-auto rounded bg-muted px-2 py-1 text-red-400">
              {l.error}
            </code>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="flex items-center gap-2">
          <input
            className="w-32 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["libs.namePlaceholder"]()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["libs.placeholder"]()}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button
            size="sm"
            onClick={add}
            disabled={busy !== null || !uri.trim()}
          >
            {busy === "add" && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            {/* The wait is a CLONE, so the button says so rather than looking stuck on 'Add'. */}
            {busy === "add" ? m["libs.cloning"]() : m["libs.add"]()}
          </Button>
        </div>
      )}

      {canEdit && serverKey && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{m["libs.serverKey"]()}</span>
          <code className="select-all break-all rounded bg-muted px-2 py-1">
            {serverKey}
          </code>
        </div>
      )}

      {notes.map((n) => (
        <p key={n} className="text-xs text-amber-500">
          {n}
        </p>
      ))}

      {error && (
        <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}
    </div>
  );
}
