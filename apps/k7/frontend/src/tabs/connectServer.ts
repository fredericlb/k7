// connectServer.ts — connecting this machine to a k7 server, from the first-launch prompt or the settings. On the tray
// the backend pairs with it (./browserAccount.ts); in a phone app signing in IS the pairing, the shell catching
// `/auth/login`, so the page navigates away. See ../../docs/localApp.md and engine/k7-runtime/docs/android.md.

import { accountBridge, inAndroidApp } from "./bridge";

const PHONE_SERVER_KEY = "k7.syncServer";

/** The phone app opens the system browser on any navigation to `/auth/login`, and keeps its `server` for pairing. */
function phoneSignIn(server: string): void {
  try {
    localStorage.setItem(PHONE_SERVER_KEY, server);
  } catch {
    // A prefill lost, nothing more.
  }
  const returnTo = encodeURIComponent(location.pathname + location.search);
  location.assign(
    `/auth/login?return_to=${returnTo}&server=${encodeURIComponent(server)}`,
  );
}

/** Connect to `origin` from a click; `another` asks a server already saved for another account. Resolves whether it paired. */
export async function connectServer(
  origin: string,
  another = false,
): Promise<boolean> {
  if (inAndroidApp()) {
    phoneSignIn(origin);
    return false;
  }
  const bridge = accountBridge();
  const paired = another
    ? await bridge?.addAccount(origin)
    : await bridge?.addServer(origin);
  return paired ?? false;
}

/** Ask ahead which servers pair with no tab: a tab is opened inside the click or never. */
export function prepareConnect(): void {
  void accountBridge()?.prepare();
}
