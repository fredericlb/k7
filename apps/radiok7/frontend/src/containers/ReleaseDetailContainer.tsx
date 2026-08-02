import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Release } from "../types";
import { ReleaseDetailView } from "../views/ReleaseDetailView";

interface Props {
  releaseId: string;
  onDeleted: () => void;
}

export function ReleaseDetailContainer({ releaseId, onDeleted }: Props) {
  const [release, setRelease] = useState<Release | null>(null);

  const load = useCallback(async () => {
    setRelease(await api.getRelease(releaseId));
  }, [releaseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddVersion = async (data: {
    name: string;
    isDefault: boolean;
    audio: File;
  }) => {
    await api.addVersion(releaseId, data);
    await load();
  };

  const handleSetDefaultVersion = async (versionId: string) => {
    await api.setDefaultVersion(releaseId, versionId);
    await load();
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
      onAddVersion={handleAddVersion}
      onSetDefaultVersion={handleSetDefaultVersion}
      onDeleteVersion={handleDeleteVersion}
      onDelete={handleDelete}
      versionAudioUrl={(versionId) => api.versionAudioUrl(releaseId, versionId)}
      versionTrackUrl={(versionId, trackId) =>
        api.versionTrackUrl(releaseId, versionId, trackId)
      }
    />
  );
}
