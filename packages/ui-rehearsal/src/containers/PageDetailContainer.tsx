import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
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

  const load = useCallback(async () => {
    setPage(await api.getPage(pageId));
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  const setReleaseIds = async (ids: string[]) => {
    await api.updatePage(pageId, { releaseIds: ids });
    await load();
    onChange();
  };

  const handleRemoveRelease = (id: string) =>
    setReleaseIds((page?.releaseIds ?? []).filter((r) => r !== id));

  const handleAddRelease = (id: string) =>
    setReleaseIds([...(page?.releaseIds ?? []), id]);

  const handleChooseVersion = async (releaseId: string, versionId: string) => {
    const { [releaseId]: _, ...others } = page?.versionIds ?? {};
    const versionIds = versionId
      ? { ...others, [releaseId]: versionId }
      : others;
    setPage(await api.updatePage(pageId, { versionIds }));
  };

  const handleRename = async (nametag: string) => {
    await api.updatePage(pageId, { nametag });
    await load();
    onChange();
  };

  const handleVisibilityChange = async (visibility: PageVisibility) => {
    setPage(await api.updatePage(pageId, { visibility }));
    onChange();
  };

  const handleDelete = async () => {
    await api.deletePage(pageId);
    onDeleted();
  };

  if (!page) return <p className="muted">{m["common.loading"]()}</p>;

  return (
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
  );
}
