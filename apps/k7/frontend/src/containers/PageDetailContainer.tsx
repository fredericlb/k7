import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Page, Release } from "../types";
import { PageDetailView } from "../views/PageDetailView";

interface Props {
  pageId: string;
  allReleases: Release[];
  onDeleted: () => void;
  onChange: () => void;
}

export function PageDetailContainer({
  pageId,
  allReleases,
  onDeleted,
  onChange,
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

  const handleDelete = async () => {
    await api.deletePage(pageId);
    onDeleted();
  };

  if (!page) return <p className="muted">Loading…</p>;

  return (
    <PageDetailView
      page={page}
      allReleases={allReleases}
      publicUrl={api.pagePublicUrl(page.nametag)}
      onRemoveRelease={handleRemoveRelease}
      onAddRelease={handleAddRelease}
      onDelete={handleDelete}
      versionAudioUrl={api.versionAudioUrl}
      versionEnvelope={api.getVersionEnvelope}
    />
  );
}
