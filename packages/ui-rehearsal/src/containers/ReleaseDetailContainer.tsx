import { useCallback, useEffect, useState } from "react";
import { api, type OnProgress } from "../api";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
import { m } from "../paraglide/messages.js";
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

  const { loadError, setLoadError, actionError, guard } = useDetailState();

  const load = useCallback(async () => {
    try {
      setRelease(await api.getRelease(releaseId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [releaseId, setLoadError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpdate = guard(async (patch: ReleasePatch) => {
    setRelease(await api.updateRelease(releaseId, patch));
    onChange();
  });

  const handleAddVersion = guard(
    async (
      data: { name: string; isDefault: boolean; audio: File },
      onProgress?: OnProgress,
    ) => {
      await api.addVersion(releaseId, data, onProgress);
      await load();
    },
  );

  const handleReplaceVersionAudio = guard(
    async (versionId: string, audio: File, onProgress?: OnProgress) => {
      await api.replaceVersionAudio(releaseId, versionId, audio, onProgress);
      await load();
    },
  );

  const handleSetDefaultVersion = guard(async (versionId: string) => {
    await api.setDefaultVersion(releaseId, versionId);
    await load();
  });

  const handleSetVersionHidden = guard(
    async (versionId: string, hidden: boolean) => {
      setRelease(await api.setVersionHidden(releaseId, versionId, hidden));
    },
  );

  const handleDeleteVersion = guard(async (versionId: string) => {
    await api.deleteVersion(releaseId, versionId);
    await load();
  });

  const handleDelete = guard(async () => {
    await api.deleteRelease(releaseId);
    onDeleted();
  });

  if (!release && loadError != null)
    return <LoadFailure error={loadError} onRetry={load} />;
  if (!release) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <ActionFailure message={actionError} />
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
        versionAudioUrl={(versionId) =>
          api.versionAudioUrl(releaseId, versionId)
        }
        versionEnvelope={(versionId) =>
          api.getVersionEnvelope(releaseId, versionId)
        }
        versionTrackUrl={(versionId, trackId) =>
          api.versionTrackUrl(releaseId, versionId, trackId)
        }
      />
    </>
  );
}
