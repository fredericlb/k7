// LibrariesPage.tsx — `/libraries`, a page of its own: the origin's libraries, each row's clone
// state, Retry and Pull, and for an admin the list's edits and the server's key.
// A page and not a panel: it is visited on purpose, rarely, and an admin reads the key off it.
// See ../../docs/projects.md.

import { AppHeader } from "@frediverse/ui/app-header";
import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Loader2 } from "@frediverse/ui/icons";
import { AskHost } from "@studio/project-shell/ask";
import { Toaster } from "@studio/project-shell/toast";
import { useEffect, useState } from "react";
import { GitBusyOverlay } from "../components/GitBusy";
import { m } from "../paraglide/messages.js";
import { findAccountFiles } from "../settings/accountFiles";
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
    <div className="flex h-full flex-col bg-background text-foreground">
      <AskHost />
      <Toaster />
      {/* Adding, removing, updating and retrying all clone or pull: the page waits for git. */}
      <GitBusyOverlay />
      <AppHeader
        title="st0"
        subtitle={m["home.libraries"]()}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <a href={import.meta.env.BASE_URL}>
              <ArrowLeft className="h-4 w-4" /> {m["libs.back"]()}
            </a>
          </Button>
        }
      />
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
    </div>
  );
}
