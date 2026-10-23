// ServerPage.tsx — `/settings/server`, what this server's ADMINS set for every account: who owns which engine, and
// the hunt's slskd access. Offered in the user menu to admins only; each card still hides itself on a 403, which is
// the routes' decision, not this page's. See ../../docs/settings.md.

import {
  EngineOwnersSettings,
  SlskdSettings,
} from "@studio/ui-library/settings";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { MediaHost } from "../projects/MediaHost";
import { PageFrame } from "../projects/PageFrame";
import { useIsAdmin } from "./useIsAdmin";

export function ServerPage() {
  const admin = useIsAdmin();
  return (
    <HomeShell>
      <PageFrame title={m["server.title"]()} narrow>
        {admin === false ? (
          <p className="text-muted-foreground text-xs">
            {m["server.notAdmin"]()}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <MediaHost>
              <EngineOwnersSettings />
              <SlskdSettings />
            </MediaHost>
          </div>
        )}
      </PageFrame>
    </HomeShell>
  );
}
