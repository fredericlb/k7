// MediaPage.tsx — `/media/…`, the media library inside the home's frame: the sections are entries
// of the sidebar, the catalogue is the page's column. The ONE home page that mounts playback,
// which probes and leases an engine — the others deliberately do not (Home.tsx).
// See packages/ui-library/docs/host.md.

import { Toaster } from "@studio/project-shell/toast";
import { MediaLibrary, MediaPlayback, QueueButton } from "@studio/ui-library";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { m } from "../paraglide/messages.js";
import { SERVER_SETTINGS_ROUTE } from "./api";
import { HomeShell } from "./HomeFrame";
import { MediaHost } from "./MediaHost";

export function MediaPage() {
  const navigate = useNavigate();
  // The library reports them, the sidebar draws them: lifted here, the one place holding both.
  const [counts, setCounts] = useState<Partial<Record<string, number>>>({});
  return (
    <MediaHost>
      {/* Around the whole frame: the queue button sits in the sidebar, above the engine, the bar under both. */}
      <MediaPlayback>
        <HomeShell actions={<QueueButton />} mediaCounts={counts}>
          <div className="flex min-h-0 flex-1 flex-col">
            <MediaLibrary
              onOpenSettings={() => navigate(SERVER_SETTINGS_ROUTE)}
              onCounts={setCounts}
            />
          </div>
        </HomeShell>
      </MediaPlayback>
      {/* What the player says without failing, an engine warning, is a toast (../engineWarnings.ts). */}
      <Toaster dismissLabel={m["common.dismiss"]()} />
    </MediaHost>
  );
}
