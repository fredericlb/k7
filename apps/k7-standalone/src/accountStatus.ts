// accountStatus.ts — where a sign-in or a pairing stands, told to k7's pages for the account bar, and its Cancel taken back.
// The main process says WHAT happened as a code; the page words it in the person's language. See docs/notices.md.

import {
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  webContents,
} from "electron";

/** Mirrored by apps/k7/frontend/src/tabs/bridge.ts. */
export type AccountStatus =
  | { state: "idle" }
  | { state: "waiting"; what: "signIn" | "pair" }
  | {
      state: "error";
      code:
        | "badServer"
        | "signInTimeout"
        | "signInFailed"
        | "pairTimeout"
        | "pairFailed"
        | "pairRefused"
        | "pairNotStored";
      detail?: string;
    }
  | { state: "done"; code: "signedIn" | "paired"; detail?: string };

let current: AccountStatus = { state: "idle" };
let origin = "";
const cancels = new Set<() => void>();

const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  try {
    return new URL(e.senderFrame?.url ?? "").origin === origin;
  } catch {
    return false;
  }
};

/** Record and push the status to every page of the app's origin: the account bar is on the home tab. */
export function setAccountStatus(s: AccountStatus): void {
  current = s;
  // An ending is news for a moment: a home page loaded later must not show it again.
  if (s.state === "done" || s.state === "error")
    setTimeout(() => {
      if (current === s) current = { state: "idle" };
    }, 10_000).unref();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (new URL(wc.getURL()).origin === origin)
        wc.send("studio:auth:status", s);
    } catch {
      // A page with no URL yet asks on mount.
    }
  }
}

/** A pending browser trip registers how to abandon it; the returned function unregisters it. */
export function onCancel(cancel: () => void): () => void {
  cancels.add(cancel);
  return () => cancels.delete(cancel);
}

/** Answer the pages of `appOrigin`: the status on ask, and Cancel. */
export function installAccountStatus(appOrigin: string): void {
  origin = appOrigin;
  ipcMain.handle("studio:auth:status", (e) => (fromApp(e) ? current : null));
  ipcMain.on("studio:auth:cancel", (e) => {
    if (!fromApp(e)) return;
    for (const c of [...cancels]) c();
    setAccountStatus({ state: "idle" });
  });
}
