// MediaPage.tsx — `/media/…`, the media library inside the home's frame: the sections are entries
// of the sidebar, the catalogue is the page's column. The ONE home page that mounts playback,
// which probes and leases an engine — the others deliberately do not (Home.tsx).
// See packages/ui-library/docs/host.md.

import {
  MediaLibrary,
  MediaPlayback,
  PlaybackPicker,
} from "@studio/ui-library";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SETTINGS_ROUTE } from "./api";
import { HomeShell } from "./HomeSidebar";
import { MediaHost } from "./MediaHost";

export function MediaPage() {
  const navigate = useNavigate();
  // The library reports them, the sidebar draws them: lifted here, the one place holding both.
  const [counts, setCounts] = useState<Partial<Record<string, number>>>({});
  return (
    <MediaHost>
      {/* Around the whole frame: the picker sits in the sidebar, the bar under both. */}
      <MediaPlayback>
        <HomeShell actions={<PlaybackPicker />} mediaCounts={counts}>
          <div className="flex min-h-0 flex-1 flex-col">
            <MediaLibrary
              onOpenSettings={() => navigate(SETTINGS_ROUTE)}
              onCounts={setCounts}
            />
          </div>
        </HomeShell>
      </MediaPlayback>
    </MediaHost>
  );
}
