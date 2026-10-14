// LibraryVersions.tsx — one library's published versions, under its row of the Libraries card, and
// for an admin the form that publishes its draft as the next one. `requires` starts at the newest
// version's, never this k7's level: raising it locks older desktops out of the upgrade. See
// ../../../../../docs/library-versions-plan.md.

import { Button } from "@frediverse/ui/button";
import { Loader2 } from "@frediverse/ui/icons";
import { LIBRARY_LEVEL } from "@studio/song-schema/libraryVersions";
import type {
  AccountLibrariesReply,
  AccountLibrary,
} from "@studio/web-protocol";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { accountFiles } from "./api";
import type { AccountFiles } from "./workspaceOps";

export function LibraryVersions({
  library,
  fileService,
  canEdit,
  onReply,
  onError,
}: {
  library: AccountLibrary;
  fileService: AccountFiles | null;
  canEdit: boolean;
  onReply: (r: AccountLibrariesReply, note: string) => void;
  onError: (message: string) => void;
}) {
  const versions = library.versions ?? [];
  const newest = versions.at(-1);
  const [notes, setNotes] = useState("");
  const [requires, setRequires] = useState(newest?.requires ?? 1);
  const [busy, setBusy] = useState(false);

  const publish = () => {
    if (!fileService) return onError(m["libs.noFiles"]());
    setBusy(true);
    void accountFiles
      .publishLibrary(fileService, library.name, { requires, notes })
      .then((r) => {
        const now = r.libraries.find((l) => l.name === library.name);
        const version = now?.versions?.at(-1)?.version ?? 0;
        onReply(r, m["libs.published"]({ name: library.name, version }));
        setNotes("");
      })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-1 pl-4 text-xs text-muted-foreground">
      <span>
        {versions.length
          ? m["libs.versions"]({
              list: versions.map((v) => v.version).join(", "),
            })
          : m["libs.noVersion"]()}
        {versions
          .filter((v) => v.requires > LIBRARY_LEVEL)
          .map((v) => (
            <span key={v.version} className="ml-2 text-amber-500">
              {m["libs.needsLevel"]({ version: v.version, level: v.requires })}
            </span>
          ))}
      </span>
      {canEdit && library.draft && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-2 py-1 outline-none focus:border-primary"
            placeholder={m["libs.publishNotes"]()}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <input
            type="number"
            min={1}
            max={LIBRARY_LEVEL}
            title={m["libs.publishRequires"]()}
            className="w-14 rounded-md border border-border bg-secondary px-2 py-1 outline-none focus:border-primary"
            value={requires}
            onChange={(e) => setRequires(Number(e.target.value) || 1)}
          />
          <Button size="sm" variant="outline" onClick={publish} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {m["libs.publish"]()}
          </Button>
        </div>
      )}
    </div>
  );
}
