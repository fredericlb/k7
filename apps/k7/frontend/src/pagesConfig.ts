// pagesConfig.ts — where the Libraries, Media and Rehearsal pages call: always this machine's backend. On a machine
// with a server (the tray once paired, a phone) the server's songs also open on demand through the backend's forward,
// and a song on both is read and written there. What reads wrong: no page ever reads the server INSTEAD of this machine.
// See ../docs/localApp.md and packages/ui-library/docs/songSource.md.

import { configureLibrary } from "@studio/ui-library/config";
import { configureRehearsal } from "@studio/ui-rehearsal/config";
import { BASE, SERVER_BASE } from "./api";
import { desktop } from "./desktop";
import { inAndroidApp } from "./tabs/bridge";

configureLibrary({
  apiBase: BASE,
  hostBase: BASE,
  serverBase: inAndroidApp() ? SERVER_BASE : undefined,
});
configureRehearsal({ apiBase: BASE, hostBase: BASE });

// The tray learns it has a server from its backend: until then its songs are its own alone.
if (!inAndroidApp())
  void desktop
    .state()
    .then((d) => {
      if (d?.server) configureLibrary({ serverBase: SERVER_BASE });
    })
    .catch(() => {});
