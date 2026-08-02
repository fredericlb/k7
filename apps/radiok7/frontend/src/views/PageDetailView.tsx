import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { useState } from "react";
import type { Page, Release } from "../types";

interface Props {
  page: Page;
  allReleases: Release[];
  onRemoveRelease: (id: string) => Promise<void>;
  onAddRelease: (id: string) => Promise<void>;
  onDelete: () => Promise<void>;
  versionAudioUrl: (releaseId: string, versionId: string) => string;
}

export function PageDetailView({
  page,
  allReleases,
  onRemoveRelease,
  onAddRelease,
  onDelete,
  versionAudioUrl,
}: Props) {
  const [adding, setAdding] = useState(false);

  const remove = async () => {
    if (!confirm("Delete this page? (releases are not deleted)")) return;
    await onDelete();
  };

  const releases = page.releases ?? [];
  const notInPage = allReleases.filter((r) => !page.releaseIds.includes(r.id));

  return (
    <div className="release-detail">
      <h2>#{page.nametag}</h2>
      <p className="muted">
        {releases.length} release{releases.length === 1 ? "" : "s"}
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="outline" size="sm" onClick={remove}>
          🗑 Delete page
        </Button>
      </div>

      <h3>Releases</h3>
      {releases.length === 0 && (
        <p className="muted">No releases on this page yet.</p>
      )}
      {releases.map((r) => {
        const def =
          r.versions?.find((v) => v.id === r.defaultVersionId) || null;
        return (
          <Card key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>
                {r.title} <span className="muted">· {r.artist}</span>
              </b>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRemoveRelease(r.id)}
              >
                Remove
              </Button>
            </div>
            {def && (
              <audio
                controls
                crossOrigin="use-credentials"
                src={versionAudioUrl(r.id, def.id)}
                style={{ width: "100%", marginTop: 8 }}
              />
            )}
          </Card>
        );
      })}

      {notInPage.length > 0 && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Add a release</h3>
          <div className="row">
            <select
              disabled={adding}
              defaultValue=""
              onChange={async (e) => {
                const id = e.target.value;
                if (!id) return;
                setAdding(true);
                try {
                  await onAddRelease(id);
                } finally {
                  setAdding(false);
                  e.target.value = "";
                }
              }}
            >
              <option value="">Choose a release…</option>
              {notInPage.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.artist}
                </option>
              ))}
            </select>
          </div>
        </Card>
      )}
    </div>
  );
}
