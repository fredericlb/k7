import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Release, ReleasePatch } from "../types";
import { ReleaseDetailView } from "../views/ReleaseDetailView";

interface Props {
  releaseId: string;
  onDeleted: () => void;
  /** The home list shows title and artist, so an edit refreshes it. */
  onChange: () => void;
  onBack: () => void;
}

export function ReleaseDetailContainer({
  releaseId,
  onDeleted,
  onChange,
  onBack,
}: Props) {
  const [release, setRelease] = useState<Release | null>(null);

  const load = useCallback(async () => {
    setRelease(await api.getRelease(releaseId));
  }, [releaseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpdate = async (patch: ReleasePatch) => {
    setRelease(await api.updateRelease(releaseId, patch));
    onChange();
  };

  const handleAddVersion = async (data: {
    name: string;
    isDefault: boolean;
    audio: File;
  }) => {
    await api.addVersion(releaseId, data);
    await load();
  };

  const handleReplaceVersionAudio = async (versionId: string, audio: File) => {
    await api.replaceVersionAudio(releaseId, versionId, audio);
    await load();
  };

  const handleSetDefaultVersion = async (versionId: string) => {
    await api.setDefaultVersion(releaseId, versionId);
    await load();
  };

  const handleSetVersionHidden = async (versionId: string, hidden: boolean) => {
    setRelease(await api.setVersionHidden(releaseId, versionId, hidden));
  };

  const handleDeleteVersion = async (versionId: string) => {
    await api.deleteVersion(releaseId, versionId);
    await load();
  };

  const handleDelete = async () => {
    await api.deleteRelease(releaseId);
    onDeleted();
  };

  if (!release) return <p className="muted">Loading…</p>;

  return (
    <ReleaseDetailView
      release={release}
      onUpdate={handleUpdate}
      onAddVersion={handleAddVersion}
      onReplaceVersionAudio={handleReplaceVersionAudio}
      onSetDefaultVersion={handleSetDefaultVersion}
      onSetVersionHidden={handleSetVersionHidden}
      onDeleteVersion={handleDeleteVersion}
      onDelete={handleDelete}
      onBack={onBack}
      versionAudioUrl={(versionId) => api.versionAudioUrl(releaseId, versionId)}
      versionEnvelope={(versionId) =>
        api.getVersionEnvelope(releaseId, versionId)
      }
      versionTrackUrl={(versionId, trackId) =>
        api.versionTrackUrl(releaseId, versionId, trackId)
      }
    />
  );
}
