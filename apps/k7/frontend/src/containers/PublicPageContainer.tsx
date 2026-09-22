import { useEffect, useState } from "react";
import { api } from "../api";
import type { Page } from "../types";
import { PublicPageView } from "../views/PublicPageView";

interface Props {
  nametag: string;
}

// No auth check here: this route sits outside <App/> entirely — see main.tsx.
export function PublicPageContainer({ nametag }: Props) {
  const [page, setPage] = useState<Page | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!nametag) return;
    api
      .getPublicPage(nametag)
      .then(setPage)
      .catch(() => setPage(null))
      .finally(() => setLoaded(true));
  }, [nametag]);

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <PublicPageView
      page={page}
      nametag={nametag}
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
