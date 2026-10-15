import { useEffect, useState } from "react";
import { api, UnauthenticatedError } from "../api";
import { m } from "../paraglide/messages.js";
import type { Page } from "../types";
import { PublicPageView } from "../views/PublicPageView";

interface Props {
  nametag: string;
}

// No auth gate here: the host draws this address before its own (PublicPages.tsx), and the page's visibility decides.
export function PublicPageContainer({ nametag }: Props) {
  const [page, setPage] = useState<Page | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    if (!nametag) return;
    api
      .getPublicPage(nametag)
      .then(setPage)
      .catch((e) => {
        setPage(null);
        setNeedsAuth(e instanceof UnauthenticatedError);
      })
      .finally(() => setLoaded(true));
  }, [nametag]);

  if (!loaded) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <PublicPageView
      page={page}
      nametag={nametag}
      loginUrl={needsAuth ? api.loginUrl : null}
      audioUrl={(releaseId, versionId) =>
        api.publicVersionAudioUrl(nametag, releaseId, versionId)
      }
      downloadUrl={(releaseId, versionId) =>
        api.publicVersionDownloadUrl(nametag, releaseId, versionId)
      }
      envelope={(releaseId, versionId) =>
        api.getPublicVersionEnvelope(nametag, releaseId, versionId)
      }
    />
  );
}
