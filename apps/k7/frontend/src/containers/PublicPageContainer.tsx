import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { Page } from "../types";
import { PublicPageView } from "../views/PublicPageView";

// No auth check here: this route sits outside <App/> entirely — see main.tsx.
export function PublicPageContainer() {
  const { nametag } = useParams();
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
      nametag={nametag ?? ""}
      audioUrl={(releaseId, versionId) =>
        api.publicVersionAudioUrl(nametag ?? "", releaseId, versionId)
      }
    />
  );
}
