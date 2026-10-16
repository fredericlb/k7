// LibrariesPage.tsx — `/libraries`, a page of its own: the origin's libraries, whether the server
// holds each, and for an admin the list's edits.
// A page and not a panel: it is visited on purpose, rarely.
// See ../../docs/projects.md.

import { Loader2 } from "@frediverse/ui/icons";
import { AskHost } from "@studio/project-shell/ask";
import { Toaster } from "@studio/project-shell/toast";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { findAccountFiles } from "../settings/accountFiles";
import { HomeShell } from "./HomeSidebar";
import { LibrariesCard } from "./LibrariesCard";
import type { AccountFiles } from "./workspaceOps";

export function LibrariesPage() {
  // `undefined` while asked: the card says "none answers" only once that is the answer.
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);
  useEffect(() => {
    let live = true;
    void findAccountFiles(false).then((f) => live && setFileService(f));
    return () => {
      live = false;
    };
  }, []);

  return (
    <HomeShell subtitle={m["home.libraries"]()}>
      <AskHost />
      <Toaster dismissLabel={m["common.dismiss"]()} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
          {fileService === undefined ? (
            <div className="flex items-center gap-2 px-6 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
              {m["libs.reading"]()}
            </div>
          ) : (
            <LibrariesCard fileService={fileService} />
          )}
        </div>
      </div>
    </HomeShell>
  );
}
