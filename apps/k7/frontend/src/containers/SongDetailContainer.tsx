import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Song, SongTab } from "../types";
import { SongDetailView } from "../views/SongDetailView";

interface Props {
  songId: string;
  initialTab?: SongTab;
  onChange: () => void;
  onDeleted: () => void;
}

export function SongDetailContainer({
  songId,
  initialTab,
  onChange,
  onDeleted,
}: Props) {
  const [song, setSong] = useState<Song | null>(null);

  const load = useCallback(async () => {
    setSong(await api.getSong(songId));
  }, [songId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (field: "lyrics" | "tablature", value: string) => {
    const updated = await api.updateSong(songId, { [field]: value });
    setSong(updated);
    onChange();
  };

  const handleUploadSheets = async (files: File[]) => {
    const updated = await api.uploadSheetFiles(songId, files);
    setSong(updated);
    onChange();
  };

  const handleDeleteSheet = async (fileId: string) => {
    const updated = await api.deleteSheetFile(songId, fileId);
    setSong(updated);
    onChange();
  };

  const handleToggleFavorite = async () => {
    if (!song) return;
    const updated = await api.updateSong(songId, { favorite: !song.favorite });
    setSong(updated);
    onChange();
  };

  const handleDelete = async () => {
    await api.deleteSong(songId);
    onDeleted();
  };

  if (!song) return <p className="muted">Loading…</p>;

  return (
    <SongDetailView
      song={song}
      initialTab={initialTab}
      onSave={handleSave}
      onUploadSheets={handleUploadSheets}
      onDeleteSheet={handleDeleteSheet}
      sheetUrl={(fileId) => api.sheetFileUrl(songId, fileId)}
      onToggleFavorite={handleToggleFavorite}
      onDelete={handleDelete}
    />
  );
}
