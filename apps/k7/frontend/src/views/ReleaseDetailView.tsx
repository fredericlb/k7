import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Checkbox } from "@frediverse/ui/checkbox";
import { Input } from "@frediverse/ui/input";
import { useState } from "react";
import { fmtDate } from "../format";
import type { Release } from "../types";

interface Props {
  release: Release;
  onAddVersion: (data: {
    name: string;
    isDefault: boolean;
    audio: File;
  }) => Promise<void>;
  onSetDefaultVersion: (versionId: string) => Promise<void>;
  onDeleteVersion: (versionId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  versionAudioUrl: (versionId: string) => string;
  versionTrackUrl: (versionId: string, trackId: string) => string;
}

export function ReleaseDetailView({
  release,
  onAddVersion,
  onSetDefaultVersion,
  onDeleteVersion,
  onDelete,
  versionAudioUrl,
  versionTrackUrl,
}: Props) {
  const [vName, setVName] = useState("");
  const [vDefault, setVDefault] = useState(true);
  const [vFile, setVFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);

  const addVersion = async () => {
    if (!vFile) return;
    setAdding(true);
    try {
      await onAddVersion({
        name: vName.trim() || `Version ${(release.versions?.length ?? 0) + 1}`,
        isDefault: vDefault,
        audio: vFile,
      });
      setVName("");
      setVFile(null);
      setVDefault(true);
    } finally {
      setAdding(false);
    }
  };

  const downloadUrl = async (url: string, label: string) => {
    const res = await fetch(url, { credentials: "include" });
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = label;
    a.click();
    URL.revokeObjectURL(objUrl);
  };

  const download = (versionId: string, label: string) =>
    downloadUrl(versionAudioUrl(versionId), label);

  const remove = async () => {
    if (!confirm("Delete this release and all its versions?")) return;
    await onDelete();
  };

  const versions = release.versions ?? [];
  const def = versions.find((v) => v.id === release.defaultVersionId) || null;

  return (
    <div className="release-detail">
      <h2>{release.title}</h2>
      <p className="muted">
        {release.artist}
        {release.releaseDate ? ` · ${release.releaseDate}` : ""}
      </p>

      {release.description && (
        <p style={{ whiteSpace: "pre-wrap" }}>{release.description}</p>
      )}

      {def ? (
        <Card style={{ marginTop: 12 }}>
          <div className="muted small">Now playing · {def.name}</div>
          <audio
            controls
            crossOrigin="use-credentials"
            src={versionAudioUrl(def.id)}
            style={{ width: "100%", marginTop: 8 }}
          />
          {def.tracks.length > 0 && (
            <div className="stems">
              <div className="muted small" style={{ marginTop: 10 }}>
                Stems ({def.tracks.length})
              </div>
              <ul className="stem-list">
                {def.tracks.map((t) => (
                  <li key={t.id} className="stem-row">
                    <span className="stem-name" title={t.name}>
                      {t.name}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      title={`Download ${t.name}`}
                      onClick={() =>
                        downloadUrl(
                          versionTrackUrl(def.id, t.id),
                          `${release.artist} - ${release.title} - ${t.name}`,
                        )
                      }
                    >
                      ⬇
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : (
        <p className="muted">No versions yet.</p>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <Badge variant={release.canDownload ? "amber" : "default"}>
          {release.canDownload
            ? "⬇ downloadable by users"
            : "download disabled"}
        </Badge>
        <Button variant="outline" size="sm" onClick={remove}>
          🗑 Delete release
        </Button>
      </div>

      <h3>Versions</h3>
      <ul className="annotation-list">
        {versions.map((v) => (
          <li
            key={v.id}
            className={`annotation-item${v.isDefault ? " validated" : ""}`}
          >
            <span className="annotation-text">
              {v.isDefault ? "★ " : ""}
              {v.name}
            </span>
            {!v.isDefault && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetDefaultVersion(v.id)}
              >
                Set default
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  v.id,
                  `${release.artist} - ${release.title} (${v.name})`,
                )
              }
            >
              ⬇
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeleteVersion(v.id)}
            >
              🗑
            </Button>
          </li>
        ))}
      </ul>

      <Card>
        <h3 style={{ marginTop: 0 }}>Add a version</h3>
        <div className="row">
          <Input
            value={vName}
            placeholder="Version name (e.g. Mix 2)"
            onChange={(e) => setVName(e.target.value)}
          />
          <Input
            type="file"
            accept="audio/*"
            onChange={(e) => setVFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <label className="mb-4 mt-2 flex items-center gap-2 text-sm">
          <Checkbox
            checked={vDefault}
            onCheckedChange={(v) => setVDefault(v === true)}
          />
          <span>Make this the default version</span>
        </label>
        <Button disabled={!vFile || adding} onClick={addVersion}>
          {adding ? "Uploading…" : "Add version"}
        </Button>
      </Card>

      <p className="muted small">Added {fmtDate(release.createdAt)}</p>
    </div>
  );
}
