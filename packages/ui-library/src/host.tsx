// host.tsx — what the app mounting the media library hands its COMPONENTS: the labels, the route
// prefix it is mounted under, and who is signed in. The fetch layer's own settings are config.ts,
// which a context cannot reach. See ../docs/host.md.

import { createContext, type ReactNode, useContext } from "react";
import type { LibraryLabels } from "./labels";

export interface LibraryHost {
  labels: LibraryLabels;
  /** The path the screens live under, e.g. "/media" — "" at the router's root. */
  prefix: string;
  /** Who is signed in: an engine session is per service AND per person. */
  user: string;
}

const HostContext = createContext<LibraryHost | null>(null);

export function LibraryHostProvider({
  value,
  children,
}: {
  value: LibraryHost;
  children: ReactNode;
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useLibraryHost(): LibraryHost {
  const h = useContext(HostContext);
  if (!h) throw new Error("useLibraryHost outside LibraryHostProvider");
  return h;
}

/** The labels alone, which is what nearly every component wants. */
export const useLabels = (): LibraryLabels => useLibraryHost().labels;
