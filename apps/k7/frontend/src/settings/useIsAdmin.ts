// useIsAdmin.ts — whether the session is one of this backend's admins (`GET /api/settings/admin`), asked once per
// page, so the user menu offers the server page to them alone. The routes behind that page still decide. See ../../docs/settings.md.

import { useEffect, useState } from "react";
import { BASE } from "../api";

let asked: Promise<boolean> | null = null;

/** The answer, asked once: false when the backend says no or cannot be reached. */
function isAdmin(): Promise<boolean> {
  asked ??= fetch(`${BASE}/api/settings/admin`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ admin?: boolean }>) : null))
    .then((b) => b?.admin === true)
    .catch(() => false);
  return asked;
}

/** `undefined` while asking, then the answer. */
export function useIsAdmin(): boolean | undefined {
  const [admin, setAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void isAdmin().then((a) => live && setAdmin(a));
    return () => {
      live = false;
    };
  }, []);
  return admin;
}
