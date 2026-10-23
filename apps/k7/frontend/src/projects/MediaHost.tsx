// MediaHost.tsx — k7 as the media library's host: the fetch layer configured once, on this
// module's import, and the labels, prefix and user handed to the screens and settings cards.
// The API is this backend's, or on the tray the paired server's through it (../serverChoice.ts).
// See packages/ui-library/docs/host.md.

import { configureLibrary, LibraryHostProvider } from "@studio/ui-library";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useLocale } from "../i18n";
import { m } from "../paraglide/messages.js";
import "../serverChoice";
import { MEDIA_ROUTE } from "./api";
import { mediaLabels } from "./mediaLabels";

// The API base is the server picker's (../serverChoice.ts), set when that module loads.
configureLibrary({
  noAnswer: (seconds) => m["media.noAnswer"]({ seconds }),
});

/** Who is signed in, as an engine session names them; "" until known. */
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

export function MediaHost({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const user = useSignedIn();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the locale is the trigger, the messages read it themselves
  const labels = useMemo(() => mediaLabels(), [locale]);
  const value = useMemo(
    () => ({ labels, prefix: MEDIA_ROUTE, user }),
    [labels, user],
  );
  return <LibraryHostProvider value={value}>{children}</LibraryHostProvider>;
}
