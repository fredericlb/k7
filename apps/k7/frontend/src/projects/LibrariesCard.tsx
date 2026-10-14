// LibrariesCard.tsx — the origin's libraries: the named folders of modules and chains EVERY project
// inherits, one list for all accounts, one folder of each on the server. Only an admin sees the add
// and remove controls and the Publish of a draft — and edits a library's draft from any project; the
// hub refuses anyone else's change anyway, so hiding them is courtesy, not the gate. A library added is
// copied from the server's seed when it holds one, else starts empty. See packages/file-hub/docs/fileHub.md.

import { Button } from "@frediverse/ui/button";
import { LibraryBig, Loader2, TriangleAlert, X } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type {
  AccountLibrariesReply,
  AccountLibrary,
} from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { accountFiles } from "./api";
import { LibraryVersions } from "./LibraryVersions";
import type { AccountFiles } from "./workspaceOps";

/** What a call did to a library, when it is worth reading: a failure, never "here". */
const worthSaying = (r: AccountLibrariesReply): string[] =>
  (r.notes ?? [])
    .filter((n) => n.state === "failed")
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    // The file hub holds them, so there is nothing to read until it answers.
    if (!fileService) return setLibraries([]);
    let live = true;
    void accountFiles
      .libraries(fileService)
      .then((r) => live && setLibraries(r.libraries))
      .catch((e: Error) => {
        setError(e.message);
        setLibraries([]);
      });
    return () => {
      live = false;
    };
  }, [fileService]);

  // Announced UP from the state and not from each setter: what this card holds is the one answer.
  useEffect(() => {
    if (libraries !== undefined) onLibraries?.(libraries);
  }, [libraries, onLibraries]);

  /** Set the whole list, and take the list and anything worth reading from the answer. */
  const save = (what: string, list: { name: string }[]) => {
    if (!fileService) return setError(m["libs.noFiles"]());
    setBusy(what);
    setError(null);
    setNotes([]);
    void accountFiles
      .setLibraries(fileService, list)
      .then((r) => {
        setLibraries(r.libraries);
        setNotes(worthSaying(r));
        if (what === "add") setName("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const listed = (libraries ?? []).map(({ name }) => ({ name }));

  const add = () => {
    const n = name.trim();
    if (n) save("add", [...listed, { name: n }]);
  };

  const remove = (gone: string) =>
    save(
      gone,
      listed.filter((l) => l.name !== gone),
    );

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
      </div>

      <p className="text-xs text-muted-foreground">
        {missing && !canEdit
          ? m["libs.missingAskAdmin"]()
          : missing
            ? parts((h) => m["libs.missingBody"](h), {
                need: <b>{m["libs.needOne"]()}</b>,
                ref: <code>@k7-core/…</code>,
                empty: <b>{m["libs.emptyWord"]()}</b>,
              })
            : m["libs.haveBody"]()}
      </p>
      {!canEdit && (
        <p className="text-xs text-muted-foreground">{m["libs.adminOnly"]()}</p>
      )}

      {libraries.map((l) => (
        <div key={l.name} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <code className="flex-1 font-semibold">@{l.name}</code>
            {!l.present && (
              <span className="shrink-0 text-amber-500">
                {m["libs.notPresent"]()}
              </span>
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
          <LibraryVersions
            library={l}
            fileService={fileService}
            canEdit={canEdit}
            onReply={(r, note) => {
              setLibraries(r.libraries);
              setError(null);
              setNotes([note]);
            }}
            onError={setError}
          />
        </div>
      ))}

      {canEdit && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary"
            placeholder={m["libs.namePlaceholder"]()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button
            size="sm"
            onClick={add}
            disabled={busy !== null || !name.trim()}
          >
            {busy === "add" && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            {m["libs.add"]()}
          </Button>
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
