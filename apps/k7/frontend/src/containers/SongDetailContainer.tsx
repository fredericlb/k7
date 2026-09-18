import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { LyricTiming, Song, SongTab } from "../types";
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

  const handleUploadAudio = async (file: File) => {
    const updated = await api.uploadSongAudio(songId, file);
    setSong(updated);
    onChange();
  };

  const handleDeleteAudio = async () => {
    const updated = await api.deleteSongAudio(songId);
    setSong(updated);
    onChange();
  };

  const handleToggleFavorite = async () => {
    if (!song) return;
    const updated = await api.setSongFavorite(songId, !song.favorite);
    setSong(updated);
    onChange();
  };

  // An LRC's outcome in one write: the lyrics when it brought them, and the line timecodes.
  const handleLrc = async (
    lyrics: string | null,
    lyricTimings: LyricTiming[],
  ) => {
    const updated = await api.updateSong(
      songId,
      lyrics === null ? { lyricTimings } : { lyrics, lyricTimings },
    );
    setSong(updated);
    onChange();
  };

  // "Fetch song" writes in two steps; each lands in the page as soon as it is done.
  const handleCopyTrack = async (path: string) => {
    setSong(await api.copyLibraryTrack(songId, path));
    onChange();
  };

  const handleMixInstrumental = async (folder: string) => {
    setSong(await api.mixInstrumental(songId, folder));
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
      onUploadAudio={handleUploadAudio}
      onDeleteAudio={handleDeleteAudio}
      audioUrl={api.songAudioUrl(songId)}
      onToggleFavorite={handleToggleFavorite}
      onLrc={handleLrc}
      onFindLrc={(duration) => api.searchLrclib(songId, duration)}
      onCopyTrack={handleCopyTrack}
      onMixInstrumental={handleMixInstrumental}
      instrumentalUrl={api.songInstrumentalUrl(songId)}
      onDelete={handleDelete}
    />
  );
}
