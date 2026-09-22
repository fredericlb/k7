import { Card } from "@frediverse/ui/card";
import { WaveformPlayer } from "../components/WaveformPlayer";
import type { Page, SongEnvelope } from "../types";

interface Props {
  page: Page | null;
  nametag: string;
  audioUrl: (releaseId: string, versionId: string) => string;
  envelope: (releaseId: string, versionId: string) => Promise<SongEnvelope>;
}

export function PublicPageView({ page, nametag, audioUrl, envelope }: Props) {
  if (!page) {
    return (
      <div className="login-screen">
        <p className="muted">No page named #{nametag}.</p>
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
          <h2>#{page.nametag}</h2>
          <p className="muted">
            {releases.length} release{releases.length === 1 ? "" : "s"}
          </p>
          {releases.map((r) => {
            // The server sends each release with the one version this page plays.
            const played =
              r.versions?.find((v) => v.id === r.defaultVersionId) || null;
            return (
              <Card key={r.id}>
                <b>
                  {r.title} <span className="muted">· {r.artist}</span>
                </b>
                {played && (
                  <WaveformPlayer
                    src={audioUrl(r.id, played.id)}
                    shapeOf={() => envelope(r.id, played.id)}
                  />
                )}
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
