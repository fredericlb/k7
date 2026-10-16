import { Button } from "@frediverse/ui/button";
import { PublicReleaseCard } from "../components/PublicReleaseCard";
import { isOne } from "../i18n";
import { m } from "../paraglide/messages.js";
import type { Page, SongEnvelope } from "../types";

interface Props {
  page: Page | null;
  nametag: string;
  /** Set when signing in may open the page: it is open to anyone signed in. */
  loginUrl: string | null;
  audioUrl: (releaseId: string, versionId: string) => string;
  downloadUrl: (releaseId: string, versionId: string) => string;
  envelope: (releaseId: string, versionId: string) => Promise<SongEnvelope>;
}

export function PublicPageView({
  page,
  nametag,
  loginUrl,
  audioUrl,
  downloadUrl,
  envelope,
}: Props) {
  if (!page && loginUrl) {
    return (
      <div className="login-screen">
        <p className="muted">{m["public.signInToSee"]({ nametag })}</p>
        <Button asChild>
          <a href={loginUrl}>{m["public.signIn"]()}</a>
        </Button>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="login-screen">
        <p className="muted">{m["public.noPage"]({ nametag })}</p>
      </div>
    );
  }

  const releases = page.releases ?? [];

  return (
    <div className="app">
      <main className="main">
        <div
          className="main-inner"
          style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}
        >
          <h2>@{page.nametag}</h2>
          <p className="muted">
            {isOne(releases.length)
              ? m["page.releaseCount.one"]({ n: releases.length })
              : m["page.releaseCount.other"]({ n: releases.length })}
          </p>
          {releases.map((r) => (
            <PublicReleaseCard
              key={r.id}
              release={r}
              audioUrl={(vid) => audioUrl(r.id, vid)}
              downloadUrl={(vid) => downloadUrl(r.id, vid)}
              envelope={(vid) => envelope(r.id, vid)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
