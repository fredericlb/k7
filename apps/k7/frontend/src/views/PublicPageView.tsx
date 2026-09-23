import { PublicReleaseCard } from "../components/PublicReleaseCard";
import type { Page, SongEnvelope } from "../types";

interface Props {
  page: Page | null;
  nametag: string;
  audioUrl: (releaseId: string, versionId: string) => string;
  downloadUrl: (releaseId: string, versionId: string) => string;
  envelope: (releaseId: string, versionId: string) => Promise<SongEnvelope>;
}

export function PublicPageView({
  page,
  nametag,
  audioUrl,
  downloadUrl,
  envelope,
}: Props) {
  if (!page) {
    return (
      <div className="login-screen">
        <p className="muted">No page named @{nametag}.</p>
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
            {releases.length} release{releases.length === 1 ? "" : "s"}
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
