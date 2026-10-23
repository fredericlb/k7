// serverChoice.ts — which server the Libraries, Media and Rehearsal pages read, on the tray: this machine's backend, or
// the account's paired server reached through it (`/api/server`, the backend's forward). Kept per browser; the engine
// and everything else stays this machine's whatever the choice. See ../docs/serverPicker.md.

import { configureLibrary } from "@studio/ui-library";
import { configureRehearsal } from "@studio/ui-rehearsal";
import { useSyncExternalStore } from "react";
import { BASE } from "./api";

export type ServerChoice = "local" | "server";

/** The backend's forward to the paired server (backend/src/remote/forward.ts). */
export const SERVER_BASE = `${BASE}/api/server`;

const KEY = "k7.serverChoice";

function stored(): ServerChoice {
  try {
    return localStorage.getItem(KEY) === "server" ? "server" : "local";
  } catch {
    return "local";
  }
}

let choice: ServerChoice = stored();
const listeners = new Set<() => void>();

/** The base the server-following pages call: `SERVER_BASE` or this backend's own. */
export const pagesBase = (): string =>
  choice === "server" ? SERVER_BASE : BASE;

/** Point both packages' fetch layers at the chosen server, this machine's own routes left on BASE. */
function apply(): void {
  configureLibrary({ apiBase: pagesBase(), hostBase: BASE });
  configureRehearsal({ apiBase: pagesBase(), hostBase: BASE });
}
apply();

export function setServerChoice(next: ServerChoice): void {
  if (next === choice) return;
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  apply();
  for (const l of listeners) l();
}

export const serverChoice = (): ServerChoice => choice;

export function useServerChoice(): ServerChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
  );
}
