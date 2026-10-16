import { useEffect, useState } from "react";
import { ApiError, api, UnauthenticatedError } from "../api";
import { LoadFailure } from "../hooks/useDetailState";
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
  // A failure that is neither "no such page" nor "sign in": the page may well exist, so it offers a retry.
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry's only way to rerun this.
  useEffect(() => {
    if (!nametag) return;
    setLoaded(false);
    setFailed(null);
    api
      .getPublicPage(nametag)
      .then(setPage)
      .catch((e) => {
        setPage(null);
        setNeedsAuth(e instanceof UnauthenticatedError);
        const absent = e instanceof ApiError && e.status === 404;
        if (!absent && !(e instanceof UnauthenticatedError)) setFailed(e);
      })
      .finally(() => setLoaded(true));
  }, [nametag, attempt]);

  if (!loaded) return <p className="muted">{m["common.loading"]()}</p>;
  if (failed)
    return (
      <LoadFailure error={failed} onRetry={() => setAttempt((n) => n + 1)} />
    );

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
