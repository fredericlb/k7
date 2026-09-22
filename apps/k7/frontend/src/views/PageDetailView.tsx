import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { pageVersion } from "@k7/shared/pageVersion";
import { useState } from "react";
import { WaveformPlayer } from "../components/WaveformPlayer";
import type { Page, Release, SongEnvelope } from "../types";

interface Props {
  page: Page;
  allReleases: Release[];
  publicUrl: string;
  onRemoveRelease: (id: string) => Promise<void>;
  onAddRelease: (id: string) => Promise<void>;
  /** An empty versionId means "the release's default". */
  onChooseVersion: (releaseId: string, versionId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  versionAudioUrl: (releaseId: string, versionId: string) => string;
  versionDownloadUrl: (releaseId: string, versionId: string) => string;
  versionEnvelope: (
    releaseId: string,
    versionId: string,
  ) => Promise<SongEnvelope>;
}

export function PageDetailView({
  page,
  allReleases,
  publicUrl,
  onRemoveRelease,
  onAddRelease,
  onChooseVersion,
  onDelete,
  versionAudioUrl,
  versionDownloadUrl,
  versionEnvelope,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  const remove = async () => {
    if (!confirm("Delete this page? (releases are not deleted)")) return;
    await onDelete();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <a href={publicUrl} target="_blank" rel="noopener noreferrer">
          {publicUrl}
        </a>
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? "✓ Copied" : "📋 Copy link"}
        </Button>
      </div>

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
        const played = pageVersion(page, r);
        const def = r.versions?.find((v) => v.id === r.defaultVersionId);
        const choices = (r.versions ?? []).filter((v) => !v.hidden);
        // A choice that fell back (hidden or deleted) shows as the default it now plays.
        const chosen = played && played.id !== def?.id ? played.id : "";
        return (
          <Card key={r.id} className="page-release">
            <div className="version-head">
              <b className="version-name">
                {r.title} <span className="muted">· {r.artist}</span>
              </b>
              <select
                aria-label={`Version of ${r.title}`}
                value={chosen}
                onChange={(e) => void onChooseVersion(r.id, e.target.value)}
              >
                <option value="">Default{def ? ` · ${def.name}` : ""}</option>
                {choices
                  .filter((v) => v.id !== def?.id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
              {r.canDownload && played && (
                <a
                  className="download-link"
                  href={versionDownloadUrl(r.id, played.id)}
                  download
                  title={`Download ${played.name}`}
                >
                  ⬇ Download
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRemoveRelease(r.id)}
              >
                Remove
              </Button>
            </div>
            {played && (
              <WaveformPlayer
                src={versionAudioUrl(r.id, played.id)}
                shapeOf={() => versionEnvelope(r.id, played.id)}
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
