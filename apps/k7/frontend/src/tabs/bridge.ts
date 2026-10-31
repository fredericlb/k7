// bridge.ts — where the account controls get their sign-in and pairing: a phone app's shell does both natively, and a
// page served by the tray's backend or a server does them itself (./browserAccount.ts). A server's page signs in elsewhere.
// See ../../docs/localApp.md.

import { useLocalApp } from "../localApp";
import { browserAccount } from "./browserAccount";

/** Where a sign-in or a pairing stands, as the account bar words it (./AccountStatusNote.tsx). */
export type AccountStatus =
  | { state: "idle" }
  /** Back from a sign-in in a browser: pairing with `server` waits on a click (./browserAccount.ts). */
  | { state: "offer"; server: string }
  | { state: "waiting"; what: "signIn" | "pair" }
  /** `as` and `local` name the two accounts of a link: the server's, and k7's here. */
  | {
      state: "error";
      code: string;
      detail?: string;
      as?: string;
      local?: string;
    }
  | { state: "done"; code: string; detail?: string };

/** Inside a phone app, whose views get `k7Android` or `k7Ios` (engine/k7-runtime/docs/android.md, docs/ios.md): its account lives on the home page too. */
export const inAndroidApp = (): boolean => {
  const phone = window as { k7Android?: unknown; k7Ios?: unknown };
  return !!(phone.k7Android ?? phone.k7Ios);
};

/** The page's own sign-in and pairing, except in a phone app, whose shell does both. */
export const accountBridge = (): typeof browserAccount | undefined =>
  inAndroidApp() ? undefined : browserAccount;

/** Where the account's sign-in control belongs on the home page: wherever this machine runs its own backend, never on a server. */
export function useHasAccountControl(): boolean {
  const local = useLocalApp();
  return inAndroidApp() || !!local;
}
