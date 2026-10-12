// RehearsalHost.tsx — st0 as the rehearsal pages' host: the fetch layer configured once, on this
// module's import, and the prefix, user and settings link handed to the screens. Its catalogue is
// its own, so it is switched to st0's language here, before anything below renders a message.

import {
  configureRehearsal,
  followLocale,
  RehearsalHostProvider,
} from "@studio/ui-rehearsal";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, BASE } from "../api";
import { useLocale } from "../i18n";
import { REHEARSAL_ROUTE, SETTINGS_ROUTE } from "./api";

configureRehearsal({ apiBase: BASE, pagesPrefix: REHEARSAL_ROUTE });

/** Who is signed in, as the chain source's engine session names them; "" until known. */
function useSignedIn(): string {
  const [user, setUser] = useState("");
  useEffect(() => {
    void api
      .getMe()
      .then((u) => setUser(u?.email || u?.sub || ""))
      .catch(() => {});
  }, []);
  return user;
}

export function RehearsalHost({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  // In render, not an effect: the children's first messages must already read this language.
  followLocale(locale);
  const user = useSignedIn();
  const value = useMemo(
    () => ({
      prefix: REHEARSAL_ROUTE,
      user,
      settingsHref: SETTINGS_ROUTE,
      onLogout: () => void api.logout().then(() => window.location.reload()),
    }),
    [user],
  );
  return (
    <RehearsalHostProvider value={value}>{children}</RehearsalHostProvider>
  );
}
