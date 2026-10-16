// host.tsx — what the app mounting the rehearsal pages hands its COMPONENTS: the route prefix they
// live under and who is signed in. The fetch layer's own settings are config.ts, which a context
// cannot reach. Every navigation goes through `useRehearsalNav`, never a bare "/sessions".

import { createContext, type ReactNode, useCallback, useContext } from "react";
import { type NavigateOptions, useNavigate } from "react-router-dom";

export interface RehearsalHost {
  /** The path the pages live under, e.g. "/rehearsal" — "" at the router's root. */
  prefix: string;
  /** Who is signed in, as the chain source's engine session names them; "" until known. */
  user: string;
  /** Signs out of the origin, when the host offers it from these pages. */
  onLogout?: () => void;
  /** Where the host's settings page is. */
  settingsHref?: string;
}

const HostContext = createContext<RehearsalHost | null>(null);

export function RehearsalHostProvider({
  value,
  children,
}: {
  value: RehearsalHost;
  children: ReactNode;
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useRehearsalHost(): RehearsalHost {
  const h = useContext(HostContext);
  if (!h) throw new Error("useRehearsalHost outside RehearsalHostProvider");
  return h;
}

/** A page's own path ("/sessions/x") under the host's prefix. */
const underPrefix = (prefix: string, path: string): string =>
  `${prefix}${path}`;

/** The page's path with the prefix taken off, or null when the address is not under it. */
export function withinPrefix(pathname: string, prefix: string): string | null {
  if (pathname === prefix) return "/";
  if (!pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length);
}

/** `path` builds an address under the prefix, `go` navigates to one. */
export function useRehearsalNav() {
  const { prefix } = useRehearsalHost();
  const navigate = useNavigate();
  const path = useCallback((p: string) => underPrefix(prefix, p), [prefix]);
  const go = useCallback(
    (p: string, options?: NavigateOptions) =>
      navigate(underPrefix(prefix, p), options),
    [navigate, prefix],
  );
  return { path, go, prefix };
}
