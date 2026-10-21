// localApp.ts — is this page served by a machine's own backend (the tray's, or a phone app's) rather than a server?
// The backend says so itself (`GET /api/local`, answered only there), asked once per page. See ../docs/localApp.md.

import { useEffect, useState } from "react";

export interface LocalApp {
  /** Whether this backend runs the machine's engine (the tray's does; the phone's engine is its app's). */
  engine: boolean;
  /** The release the tray ships under, or the backend's version. */
  version: string;
}

let asked: Promise<LocalApp | null> | null = null;

/** The answer, asked once: null on a server, or when the backend could not be reached. */
export function localApp(): Promise<LocalApp | null> {
  asked ??= fetch("/api/local", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<LocalApp>) : null))
    .catch(() => null);
  return asked;
}

/** `undefined` while asking, then the answer. */
export function useLocalApp(): LocalApp | null | undefined {
  const [app, setApp] = useState<LocalApp | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void localApp().then((a) => live && setApp(a));
    return () => {
      live = false;
    };
  }, []);
  return app;
}
