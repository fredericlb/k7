// MediaHost.tsx — k7 as the media library's host: the fetch layer configured once, on this
// module's import, and the labels, prefix, user, the home bar's engine choice and the way lyrics,
// tablature and sheets are drawn handed to the screens.
// The API is this backend's, or on the tray the paired server's through it (../serverChoice.ts).
// See packages/ui-library/docs/host.md.

import type { EngineWarning } from "@studio/engine-browser";
import {
  configureLibrary,
  LibraryHostProvider,
  type SongAttachmentView,
} from "@studio/ui-library";
import { StartFirstSessionButton } from "@studio/ui-rehearsal";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api";
import { rawText, toastEngineWarning } from "../engineWarnings";
import { useHomeEngineId } from "../homeEngine";
import { useLocale } from "../i18n";
import { useListenHere } from "../listenHere";
import { m } from "../paraglide/messages.js";
import "../serverChoice";
import { MEDIA_ROUTE, REHEARSAL_ROUTE } from "./api";
import { mediaLabels } from "./mediaLabels";

// The API base is the server picker's (../serverChoice.ts), set when that module loads.
configureLibrary({
  noAnswer: (seconds) => m["media.noAnswer"]({ seconds }),
});

// Its own drawing, fetched the first time a song with lyrics, a tab or a sheet is opened.
const SongAttachment = lazy(() =>
  import("@studio/ui-rehearsal/songAttachment").then((mod) => ({
    default: mod.SongAttachment,
  })),
);

/** A song's attachment, drawn by the rehearsal package (packages/ui-library/docs/songPlayer.md). */
const songAttachment = (props: SongAttachmentView) => (
  <Suspense fallback={null}>
    <SongAttachment {...props} />
  </Suspense>
);

/** A capture opens on the rehearsal page that cuts moments from it (packages/ui-library/docs/recordings.md). */
const recordingHref = (path: string) =>
  `${REHEARSAL_ROUTE}/recording?${new URLSearchParams({ path })}`;
const momentHref = (id: string) =>
  `${REHEARSAL_ROUTE}/moments/${encodeURIComponent(id)}`;

/** A warning the médiathèque's player is not failing on: a toast, as the editor says it (../engineWarnings.ts). */
const onEngineWarning = (w: EngineWarning) => {
  console.warn(`engine: ${rawText(w)}`);
  toastEngineWarning("media", w);
};

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
  // The home bar's engine selector: "The engine" plays on the engine it shows, heard where its radio says.
  const engineId = useHomeEngineId();
  const listenHere = useListenHere();
  const value = useMemo(
    () => ({
      labels,
      prefix: MEDIA_ROUTE,
      user,
      engine: { id: engineId, listenHere },
      songAttachment,
      recordingHref,
      momentHref,
      onEngineWarning,
      // The red dot's start, named, beside the captures it files into.
      recordButton: <StartFirstSessionButton />,
    }),
    [labels, user, engineId, listenHere],
  );
  return <LibraryHostProvider value={value}>{children}</LibraryHostProvider>;
}
