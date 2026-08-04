import { useCallback, useEffect, useState } from "react";

// Minimal pushState router (React port of composables/useRoute.ts). Three
// routes (/, /s/:slug, /t/:token) don't earn a router dependency. nginx's
// SPA fallback + Vite's historyApiFallback keep deep links refreshable.
export function useRoute() {
  const [path, setPath] = useState<string>(window.location.pathname || "/");

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback(
    (to: string, opts: { replace?: boolean } = {}) => {
      setPath((cur) => {
        if (to === cur) return cur;
        if (opts.replace) window.history.replaceState({}, "", to);
        else window.history.pushState({}, "", to);
        return to;
      });
    },
    [],
  );

  return { path, navigate };
}

export function sessionNameToSlug(name: string): string {
  return encodeURIComponent(name);
}

export function slugToSessionName(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
