import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  ActionFailure,
  LoadFailure,
  useDetailState,
} from "../hooks/useDetailState";
import { m } from "../paraglide/messages.js";
import type { Page, PageVisibility, Release } from "../types";
import { PageDetailView } from "../views/PageDetailView";

interface Props {
  pageId: string;
  allReleases: Release[];
  onDeleted: () => void;
  onChange: () => void;
  onBack: () => void;
}

export function PageDetailContainer({
  pageId,
  allReleases,
  onDeleted,
  onChange,
  onBack,
}: Props) {
  const [page, setPage] = useState<Page | null>(null);

  const { loadError, setLoadError, actionError, guard } = useDetailState();

  const load = useCallback(async () => {
    try {
      setPage(await api.getPage(pageId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [pageId, setLoadError]);

  useEffect(() => {
    load();
  }, [load]);

  const setReleaseIds = guard(async (ids: string[]) => {
    await api.updatePage(pageId, { releaseIds: ids });
    await load();
    onChange();
  });

  const handleRemoveRelease = (id: string) =>
    setReleaseIds((page?.releaseIds ?? []).filter((r) => r !== id));

  const handleAddRelease = (id: string) =>
    setReleaseIds([...(page?.releaseIds ?? []), id]);

  const handleChooseVersion = guard(
    async (releaseId: string, versionId: string) => {
      const { [releaseId]: _, ...others } = page?.versionIds ?? {};
      const versionIds = versionId
        ? { ...others, [releaseId]: versionId }
        : others;
      setPage(await api.updatePage(pageId, { versionIds }));
    },
  );

  const handleRename = guard(async (nametag: string) => {
    await api.updatePage(pageId, { nametag });
    await load();
    onChange();
  });

  const handleVisibilityChange = guard(async (visibility: PageVisibility) => {
    setPage(await api.updatePage(pageId, { visibility }));
    onChange();
  });

  const handleDelete = guard(async () => {
    await api.deletePage(pageId);
    onDeleted();
  });

  if (!page && loadError != null)
    return <LoadFailure error={loadError} onRetry={load} />;
  if (!page) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <ActionFailure message={actionError} />
      <PageDetailView
        page={page}
        allReleases={allReleases}
        publicUrl={api.pagePublicUrl(page.nametag)}
        onRemoveRelease={handleRemoveRelease}
        onAddRelease={handleAddRelease}
        onChooseVersion={handleChooseVersion}
        onDelete={handleDelete}
        onRename={handleRename}
        onVisibilityChange={handleVisibilityChange}
        onBack={onBack}
        versionAudioUrl={api.versionAudioUrl}
        versionDownloadUrl={api.versionDownloadUrl}
        versionEnvelope={api.getVersionEnvelope}
      />
    </>
  );
}
