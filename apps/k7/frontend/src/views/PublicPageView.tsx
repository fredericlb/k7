import { Card } from "@frediverse/ui/card";
import type { Page } from "../types";

interface Props {
  page: Page | null;
  nametag: string;
  audioUrl: (releaseId: string, versionId: string) => string;
}

export function PublicPageView({ page, nametag, audioUrl }: Props) {
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
            const def =
              r.versions?.find((v) => v.id === r.defaultVersionId) || null;
            return (
              <Card key={r.id}>
                <b>
                  {r.title} <span className="muted">· {r.artist}</span>
                </b>
                {def && (
                  <audio
                    controls
                    src={audioUrl(r.id, def.id)}
                    style={{ width: "100%", marginTop: 8 }}
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
