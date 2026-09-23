import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { pl8 } from "../fetchSong/pl8";
import {
  type PipelineMode,
  type PipelineSteps,
  runPipeline,
  type StatusPatch,
} from "../fetchSong/run";
import { m } from "../paraglide/messages.js";
import type { LyricTiming, Song, SongTab } from "../types";
import { SongDetailView } from "../views/SongDetailView";

interface Props {
  songId: string;
  initialTab?: SongTab;
  onChange: () => void;
  onDeleted: () => void;
  onBack: () => void;
}

export function SongDetailContainer({
  songId,
  initialTab,
  onChange,
  onDeleted,
  onBack,
}: Props) {
  const [song, setSong] = useState<Song | null>(null);

  // Applies a status patch to the local song immediately (so the bar/label move without
  // waiting on a round trip) and persists it, so a reload finds the pipeline where it left off.
  const onStatus = useCallback(
    (patch: StatusPatch) => {
      const { lyricsMatch, ...fetchStatus } = patch;
      setSong((prev) =>
        prev
          ? {
              ...prev,
              fetchStatus: { ...prev.fetchStatus, ...fetchStatus },
              ...(lyricsMatch !== undefined ? { lyricsMatch } : {}),
            }
          : prev,
      );
      void api.updateSong(songId, {
        ...(Object.keys(fetchStatus).length ? { fetchStatus } : {}),
        ...(lyricsMatch !== undefined ? { lyricsMatch } : {}),
      });
    },
    [songId],
  );

  const pipelineSteps = useCallback(
    (): PipelineSteps => ({
      pl8,
      onPhase: () => {}, // song.fetchStatus (via onStatus) is what the page actually reads
      onStatus,
      copyTrack: async (path) => {
        const updated = await api.copyLibraryTrack(songId, path);
        setSong(updated);
        return updated;
      },
      mixInstrumental: async (folder) => {
        const updated = await api.mixInstrumental(songId, folder);
        setSong(updated);
        return updated;
      },
      findLrc: (duration) => api.searchLrclib(songId, duration),
      onLrc: async (lyrics, timings) => {
        const updated = await api.updateSong(songId, {
          lyrics,
          lyricTimings: timings,
        });
        setSong(updated);
        return updated;
      },
    }),
    [songId, onStatus],
  );

  // Search → download → stem → find lyrics, from wherever `start` says the pipeline stands.
  const runFetch = useCallback(
    async (start: Song, mode: PipelineMode) => {
      try {
        const result = await runPipeline(start, mode, pipelineSteps());
        setSong(result);
        onChange();
      } catch (err) {
        const patch: StatusPatch = {
          phase: "failed",
          error: (err as Error).message,
        };
        setSong((prev) =>
          prev
            ? { ...prev, fetchStatus: { ...prev.fetchStatus, ...patch } }
            : prev,
        );
        void api.updateSong(songId, { fetchStatus: patch });
      }
    },
    [songId, pipelineSteps, onChange],
  );

  const load = useCallback(async () => {
    const fetched = await api.getSong(songId);
    setSong(fetched);
    // A hunt or a stem cut still running when the page loads is one this tab never started —
    // pick it back up rather than showing an empty choice again.
    if (
      fetched &&
      fetched.fetchStatus.phase !== "" &&
      fetched.fetchStatus.phase !== "failed"
    ) {
      void runFetch(fetched, "continue");
    }
  }, [songId, runFetch]);

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

  // "Replace the track…" in the ⋮ menu — a straight swap, no pipeline involved.
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

  // "Make instrumental" in the ⋮ menu — the no-engine-online retry, outside the pipeline.
  const handleMixInstrumental = async (folder: string) => {
    const updated = await api.mixInstrumental(songId, folder);
    setSong(updated);
    onChange();
    return updated;
  };

  const handleDelete = async () => {
    await api.deleteSong(songId);
    onDeleted();
  };

  // The auto-fetch insert's two entry points: a fresh Soulseek hunt, or a file that already
  // landed — either way the pipeline takes it from there (stemming, then lyrics).
  const handleDownload = () => {
    if (song) void runFetch(song, "download");
  };
  const handleUpload = (file: File) => {
    void (async () => {
      const updated = await api.uploadSongAudio(songId, file);
      setSong(updated);
      onChange();
      await runFetch(updated, "continue");
    })();
  };

  const handleIgnore = () => {
    void (async () => {
      const updated = await api.updateSong(songId, { fetchIgnored: true });
      setSong(updated);
    })();
  };

  if (!song) return <p className="muted">{m["common.loading"]()}</p>;

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
      onMixInstrumental={handleMixInstrumental}
      instrumentalUrl={api.songInstrumentalUrl(songId)}
      onDelete={handleDelete}
      onBack={onBack}
      onDownload={handleDownload}
      onUpload={handleUpload}
      onIgnore={handleIgnore}
    />
  );
}
