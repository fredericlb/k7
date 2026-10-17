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
import { PageFrame } from "./PageFrame";
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
      <PageFrame title={m["home.libraries"]()} narrow>
        {fileService === undefined ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
            {m["libs.reading"]()}
          </div>
        ) : (
          <LibrariesCard fileService={fileService} inPage />
        )}
      </PageFrame>
    </HomeShell>
  );
}
