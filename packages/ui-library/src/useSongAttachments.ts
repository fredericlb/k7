// useSongAttachments.ts — a song's lyrics, chords, tablature and sheets as the song page holds
// them: read from the songbook, typed, sent and removed, and the tab open over them. The header's
// menu adds and the tabs draw, so both read this one state. A song becomes a songbook song at its
// first text or sheet (adoptSongbook). See ../docs/songPlayer.md.

import type { MediatekEntry, SongbookSong } from "@studio/mediatek/types";
import { canonicalSheetMime } from "@studio/rehearsal-shared/sheetKind";
import { useCallback, useEffect, useState } from "react";
import { type SongAttachmentView, useLabels } from "./host";
import { type SongSource, useSongSource } from "./songSource";

export type AttachmentKind = Exclude<SongAttachmentView["kind"], "diagrams">;
export type SongTab = "info" | "diagrams" | AttachmentKind;
/** The texts typed by hand here: the lyrics too, when none were found or they need fixing. */
export type Typed = "lyrics" | "chords" | "tablature";

export interface SongAttachments {
  song: SongbookSong | null;
  has: Record<AttachmentKind, boolean>;
  editing: Typed | null;
  looking: boolean;
  sending: boolean;
  /** False on a read-only song: nothing may be added, typed or removed. */
  writable: boolean;
  tab: SongTab;
  setTab: (tab: SongTab) => void;
  startTyping: (kind: Typed) => void;
  saveText: (kind: Typed, text: string) => Promise<void>;
  cancelTyping: () => void;
  sendSheets: (files: File[]) => Promise<void>;
  removeSheet: (sheet: string) => Promise<void>;
}

export function useSongAttachments(
  entry: MediatekEntry,
  onSaved: () => void,
  onStatus: (status: string) => void,
): SongAttachments {
  const l = useLabels().song;
  const { read, write: writer, readOnly } = useSongSource();
  /** Where an edit goes; a read-only song throws the reason, which the status line says. */
  const write = (): NonNullable<SongSource["write"]> => {
    if (!writer) throw new Error(readOnly ?? "");
    return writer;
  };
  const meta = entry.meta ?? {};
  const listedId = typeof meta.uuid === "string" ? meta.uuid : "";
  // The listing's id, or the one the first text or sheet gave it before the listing caught up.
  const [adopted, setAdopted] = useState("");
  const id = listedId || adopted;
  const [tab, setTab] = useState<SongTab>("info");
  const [song, setSong] = useState<SongbookSong | null>(null);
  const [editing, setEditing] = useState<Typed | null>(null);
  const [sending, setSending] = useState(false);
  const [looking, setLooking] = useState(false);

  // What it carries: the song read whole once it is, the listing's flags until then.
  const has: Record<AttachmentKind, boolean> = song
    ? {
        lyrics: Boolean(song.lyrics),
        chords: Boolean(song.chords),
        tablature: Boolean(song.tablature),
        sheet: song.facts.sheets.length > 0,
      }
    : {
        lyrics: Boolean(meta.lyrics),
        chords: Boolean(meta.chords),
        tablature: Boolean(meta.tabs),
        sheet: typeof meta.sheets === "number" && meta.sheets > 0,
      };

  // Another song opens on its info and waveform, with nothing of the last one's held.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the song's path is the trigger, read by nothing inside.
  useEffect(() => {
    setTab("info");
    setEditing(null);
    setAdopted("");
    setSong(null);
  }, [entry.path]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void read
      .songbook(id)
      .then((s) => alive && setSong(s))
      .catch((e: Error) => alive && onStatus(e.message));
    return () => {
      alive = false;
    };
  }, [id, onStatus, read]);

  /** The song's songbook id, its own folder adopted when it has none yet. */
  const ensureId = async (): Promise<string> => {
    if (id) return id;
    const made = await write().adoptSongbook({
      folder: entry.path,
      artist: typeof meta.artist === "string" ? meta.artist : "",
      title: entry.name,
    });
    setAdopted(made.id);
    setSong(made);
    return made.id;
  };

  const startTyping = useCallback((kind: Typed) => {
    setEditing(kind);
    setTab(kind);
  }, []);

  /** The lyrics looked up now; found and timed, the chords come back timed with them. */
  const lookUpLyrics = async (sid: string) => {
    setLooking(true);
    onStatus(l.lookingForLyrics);
    try {
      const after = await write().lookUpLyrics(sid);
      setSong(after);
      onStatus(after.lyrics ? l.lyricsFound : l.lyricsNotFound);
      if (after.lyrics) onSaved();
    } catch (e) {
      onStatus((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const saveText = async (kind: Typed, text: string) => {
    try {
      const sid = await ensureId();
      const saved = await write().patchSongbook(sid, { [kind]: text });
      setSong(saved);
      setEditing(null);
      // An emptied text is removed, and its tab with it.
      if (!text.trim()) setTab("info");
      onSaved();
      // Chords with no lyrics to take their times from: the lyrics are asked for, if there is audio to name them.
      if (kind === "chords" && text.trim() && !saved.lyrics && saved.master)
        void lookUpLyrics(sid);
    } catch (e) {
      onStatus((e as Error).message);
      throw e;
    }
  };

  const cancelTyping = () => {
    if (editing && !has[editing]) setTab("info");
    setEditing(null);
  };

  /** The picked sheets, one after another: each is a whole file, and they are appended in that order. */
  const sendSheets = async (files: File[]) => {
    setSending(true);
    try {
      let sid = "";
      for (const file of files) {
        const mime = canonicalSheetMime(file.name, file.type);
        if (!mime) {
          onStatus(l.notASheet(file.name));
          continue;
        }
        sid ||= await ensureId();
        setSong(await write().addSheet(sid, file, mime));
        setTab("sheet");
      }
      if (sid) onSaved();
    } catch (e) {
      onStatus((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const removeSheet = async (sheet: string) => {
    if (!id) return;
    try {
      const after = await write().removeSheet(id, sheet);
      setSong(after);
      if (!after.facts.sheets.length) setTab("info");
      onSaved();
    } catch (e) {
      onStatus((e as Error).message);
    }
  };

  return {
    song,
    has,
    editing,
    looking,
    sending,
    writable: writer !== null,
    tab,
    setTab,
    startTyping,
    saveText,
    cancelTyping,
    sendSheets,
    removeSheet,
  };
}
