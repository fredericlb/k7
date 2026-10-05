import { hasTimecodes, withoutTimecodes } from "@k7/lyrics";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { UploadTrackDialog } from "../components/UploadTrackDialog";
import { pl8 } from "../fetchSong/pl8";
import {
  type PipelineMode,
  type PipelineOptions,
  type PipelineSteps,
  runPipeline,
  type StatusPatch,
  syncLyrics,
} from "../fetchSong/run";
import { m } from "../paraglide/messages.js";
import type { Song, SongTab } from "../types";
import { SongDetailView } from "../views/SongDetailView";

interface Props {
  songId: string;
  initialTab?: SongTab;
  onChange: () => void;
  onDeleted: () => void;
  onBack: () => void;
}

// The pipeline running for each song, across pages: a song's page left and reopened must not run a second one beside the first.
const pipelines = new Map<string, Promise<void>>();

export function SongDetailContainer({
  songId,
  initialTab,
  onChange,
  onDeleted,
  onBack,
}: Props) {
  const [song, setSong] = useState<Song | null>(null);
  // The uploaded file the popin is asking about, and where its answer goes; null when it is closed.
  const [asking, setAsking] = useState<{
    file: File;
    answer: (options: Required<PipelineOptions> | null) => void;
  } | null>(null);
  // Status writes go out one after the other: two PATCHes racing could leave a stale phase stored.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const running = useRef(false);
  // The parent hands a new onChange every render; read through a ref so the page never reloads for it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      const body = {
        ...(Object.keys(fetchStatus).length ? { fetchStatus } : {}),
        ...(lyricsMatch !== undefined ? { lyricsMatch } : {}),
      };
      writes.current = writes.current
        .catch(() => {})
        .then(() => api.updateSong(songId, body));
      return writes.current;
    },
    [songId],
  );

  // A song a step returned, minus the pipeline state: onStatus is ahead of what the server echoed.
  const adopt = useCallback((updated: Song) => {
    setSong((prev) =>
      prev
        ? {
            ...updated,
            fetchStatus: prev.fetchStatus,
            lyricsMatch: prev.lyricsMatch,
          }
        : updated,
    );
    return updated;
  }, []);

  // Aborted when this page goes, so its pipeline's polls stop with it (fetchSong/run.ts).
  const leaving = useRef(new AbortController());
  useEffect(() => {
    // A fresh controller on every mount: StrictMode mounts, unmounts and mounts the same instance.
    leaving.current = new AbortController();
    return () => leaving.current.abort();
  }, []);

  const pipelineSteps = useCallback(
    (): PipelineSteps => ({
      pl8,
      signal: leaving.current.signal,
      onPhase: () => {}, // song.fetchStatus (via onStatus) is what the page actually reads
      onStatus,
      copyTrack: async (path) =>
        adopt(await api.copyLibraryTrack(songId, path)),
      mixInstrumental: async (folder) =>
        adopt(await api.mixInstrumental(songId, folder)),
      // The track's length ranks LRCLIB's versions, so a live cut does not time the album take.
      findLrc: async (duration) =>
        api.searchLrclib(
          songId,
          duration ??
            (await api
              .getSongEnvelope(songId)
              .then((s) => s.seconds)
              .catch(() => undefined)),
        ),
      // The timecodes are IN the text now: a timing stored beside it would only disagree with them.
      onLrc: async (lyrics) =>
        adopt(await api.updateSong(songId, { lyrics, lyricTimings: [] })),
    }),
    [songId, onStatus, adopt],
  );

  // Search → download → stem → find lyrics, from wherever `start` says the pipeline stands.
  // A failure is stored on the song, so it is still shown after a reload until a re-run or a dismiss.
  const runFetch = useCallback(
    async (start: Song, mode: PipelineMode, options?: PipelineOptions) => {
      // One run per page: a second would race the first and clear its phase when it finishes.
      if (running.current) return;
      running.current = true;
      // …and one per SONG across pages: a page left and come back to waits for the old run to wind down before continuing.
      const before = pipelines.get(songId);
      let done = () => {};
      const mine = new Promise<void>((r) => {
        done = r;
      });
      pipelines.set(songId, mine);
      await before;
      try {
        if (leaving.current.signal.aborted) return;
        if (start.fetchStatus.phase === "failed")
          void onStatus({ phase: "", error: "" });
        adopt(await runPipeline(start, mode, pipelineSteps(), options));
        onChangeRef.current();
      } catch (err) {
        // The page went, not the job: nothing failed, and the next page to open this song picks it up.
        if (leaving.current.signal.aborted) return;
        // The hunt or job it was polling is dead: a retry must not resume it.
        void onStatus({
          phase: "failed",
          error: (err as Error).message,
          progress: null,
          huntId: "",
          jobId: "",
        });
      } finally {
        running.current = false;
        done();
        if (pipelines.get(songId) === mine) pipelines.delete(songId);
      }
    },
    [songId, pipelineSteps, onStatus, adopt],
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

  // Both ways in — the insert's upload and the ⋮ menu's "Add a track…" — ask first, then run what was kept.
  const uploadTrack = async (file: File) => {
    const options = await new Promise<Required<PipelineOptions> | null>(
      (answer) => setAsking({ file, answer }),
    );
    if (!options) return;
    const updated = await api.uploadSongAudio(songId, file);
    setSong(updated);
    onChange();
    if (options.lyrics || options.instrumental)
      void runFetch(updated, "continue", options);
  };

  const answer = (options: Required<PipelineOptions> | null) => {
    asking?.answer(options);
    setAsking(null);
  };

  const handleToggleFavorite = async () => {
    if (!song) return;
    const updated = await api.setSongFavorite(songId, !song.favorite);
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
    void uploadTrack(file);
  };

  // The insert's Retry after a failure: every step not done yet, lyrics included once unmatched —
  // a song with no timings tries again. It keeps the track it has, unlike the ⋮ menu's re-run below.
  const handleRerun = () => {
    if (!song) return;
    const lyricsAgain =
      !hasTimecodes(song.lyrics) &&
      !(song.lyricTimings?.length ?? 0) &&
      song.lyricsMatch !== "";
    void runFetch(
      lyricsAgain ? { ...song, lyricsMatch: "" } : song,
      "download",
    );
  };

  // "Run the pipeline again" in the ⋮ menu: the library track is unlinked first, so the run starts
  // over from the search rather than keeping what an earlier one found.
  const handleRestart = () => {
    if (!song || running.current) return;
    void (async () => {
      try {
        const unlinked = await api.unlinkSongAudio(songId);
        setSong(unlinked);
        const lyricsAgain =
          !hasTimecodes(unlinked.lyrics) &&
          !(unlinked.lyricTimings?.length ?? 0) &&
          unlinked.lyricsMatch !== "";
        await runFetch(
          lyricsAgain ? { ...unlinked, lyricsMatch: "" } : unlinked,
          "download",
        );
      } catch (err) {
        void onStatus({ phase: "failed", error: (err as Error).message });
      }
    })();
  };

  // « Resync lyrics » in the ⋮ menu: the codes come off, and LRCLIB times the lyrics again — nothing else runs.
  const handleResyncLyrics = () => {
    if (!song || running.current) return;
    running.current = true;
    void (async () => {
      try {
        const cleared = adopt(
          await api.updateSong(songId, {
            lyrics: withoutTimecodes(song.lyrics),
            lyricTimings: [],
          }),
        );
        void onStatus({ lyricsMatch: "", phase: "", error: "" });
        adopt(await syncLyrics(cleared, pipelineSteps()));
        void onStatus({ phase: "" });
        onChangeRef.current();
      } catch (err) {
        void onStatus({ phase: "failed", error: (err as Error).message });
      } finally {
        running.current = false;
      }
    })();
  };

  // The ⋮ menu's popin: a failure is thrown back to it, where it is shown.
  const handleRename = async (artist: string, title: string) => {
    adopt(await api.updateSong(songId, { artist, title }));
    onChange();
  };

  const handleDismissFailure = () => {
    void onStatus({ phase: "", error: "" });
  };

  const handleIgnore = () => {
    void (async () => {
      const updated = await api.updateSong(songId, { fetchIgnored: true });
      setSong(updated);
    })();
  };

  if (!song) return <p className="muted">{m["common.loading"]()}</p>;

  return (
    <>
      <SongDetailView
        song={song}
        initialTab={initialTab}
        onSave={handleSave}
        onUploadSheets={handleUploadSheets}
        onDeleteSheet={handleDeleteSheet}
        sheetUrl={(fileId) => api.sheetFileUrl(songId, fileId)}
        onUploadAudio={uploadTrack}
        onToggleFavorite={handleToggleFavorite}
        onMixInstrumental={handleMixInstrumental}
        onDelete={handleDelete}
        onBack={onBack}
        onDownload={handleDownload}
        onUpload={handleUpload}
        onIgnore={handleIgnore}
        onRerun={handleRerun}
        onRestart={handleRestart}
        onResyncLyrics={handleResyncLyrics}
        onRename={handleRename}
        onDismissFailure={handleDismissFailure}
      />
      <UploadTrackDialog
        file={asking?.file ?? null}
        onConfirm={answer}
        onCancel={() => answer(null)}
      />
    </>
  );
}
