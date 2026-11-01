// connectServer.ts — signing this machine in to its ONE k7 server, from the first-launch prompt or the settings; signing
// in is linking (packages/file-hub/docs/syncRelay.md, "Signing in is pairing"). On the tray the page opens the server's
// sign-in in a tab (./browserAccount.ts); in a phone app the shell catches `/auth/login` and opens it in its own browser
// sheet, so the page navigates away. See ../../docs/localApp.md and engine/k7-runtime/docs/android.md.

import { savedServersCall } from "../settings/savedServers";
import { accountBridge, inAndroidApp } from "./bridge";

/** The phone app catches any navigation to `/auth/login` and signs in to `server` in its browser sheet. */
function phoneSignIn(server: string): void {
  const returnTo = encodeURIComponent(location.pathname + location.search);
  location.assign(
    `/auth/login?return_to=${returnTo}&server=${encodeURIComponent(server)}`,
  );
}

/** Sign in to `origin` from a click. Resolves whether it is linked; a phone's page leaves for the sheet instead. */
export async function connectServer(origin: string): Promise<boolean> {
  if (inAndroidApp()) {
    phoneSignIn(origin);
    return false;
  }
  return (await accountBridge()?.signIn(origin)) ?? false;
}

/** Sign out: the link is forgotten and its token handed back to the server; what is on this machine stays. */
export async function signOutServer(): Promise<void> {
  await savedServersCall("DELETE");
}
