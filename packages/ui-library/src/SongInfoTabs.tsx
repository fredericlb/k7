// SongInfoTabs.tsx — the song screen's left half: its tags, then a tab per attachment it carries —
// lyrics, chords, tablature, sheets — drawn by the host exactly as the songbook draws them, and
// buttons over them to add each as the songbook does. The CHORDS take the lyrics' times on the
// server; chords saved with no lyrics ask for them first (../docs/songPlayer.md).

import { Button } from "@frediverse/ui/button";
import {
  FileMusic,
  Guitar,
  Loader2,
  MicVocal,
  Music,
} from "@frediverse/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import type { MediatekEntry, SongbookSong } from "@studio/mediatek/types";
import {
  canonicalSheetMime,
  SHEET_ACCEPT,
} from "@studio/rehearsal-shared/sheetKind";
import { useEffect, useRef, useState } from "react";
import { library } from "./api";
import { type SongAttachmentView, useLabels, useLibraryHost } from "./host";
import { SongTagsForm } from "./SongTagsForm";
import { SongTextEditor } from "./SongTextEditor";

type Kind = SongAttachmentView["kind"];
type Tab = "info" | Kind;
/** The texts typed by hand here: the lyrics too, when none were found or they need fixing. */
type Typed = "lyrics" | "chords" | "tablature";

export function SongInfoTabs({
  entry,
  onSaved,
  onStatus,
}: {
  entry: MediatekEntry;
  onSaved: () => void;
  onStatus: (status: string) => void;
}) {
  const l = useLabels().song;
  const { songAttachment } = useLibraryHost();
  const meta = entry.meta ?? {};
  const listedId = typeof meta.uuid === "string" ? meta.uuid : "";
  // The listing's id, or the one the first chords, tab or sheet gave it before the listing caught up.
  const [adopted, setAdopted] = useState("");
  const id = listedId || adopted;
  const [tab, setTab] = useState<Tab>("info");
  const [song, setSong] = useState<SongbookSong | null>(null);
  const [editing, setEditing] = useState<Typed | null>(null);
  const [sending, setSending] = useState(false);
  const [looking, setLooking] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);

  // What it carries: the song read whole once it is, the listing's flags until then.
  const has: Record<Kind, boolean> = song
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
  const order: Kind[] = ["lyrics", "chords", "tablature", "sheet"];
  // A text being typed for the first time has its tab already, so the editor has somewhere to be.
  const shown = songAttachment
    ? order.filter((k) => has[k] || k === editing)
    : [];

  // Another song opens on its tags, with nothing of the last one's held.
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
    void library
      .songbook(id)
      .then((s) => alive && setSong(s))
      .catch((e: Error) => alive && onStatus(e.message));
    return () => {
      alive = false;
    };
  }, [id, onStatus]);

  /** The song's songbook id, its own folder adopted when it has none yet. */
  const ensureId = async (): Promise<string> => {
    if (id) return id;
    const made = await library.adoptSongbook({
      folder: entry.path,
      artist: typeof meta.artist === "string" ? meta.artist : "",
      title: entry.name,
    });
    setAdopted(made.id);
    setSong(made);
    return made.id;
  };

  const startTyping = (kind: Typed) => {
    setEditing(kind);
    setTab(kind);
  };

  const saveText = async (kind: Typed, text: string) => {
    try {
      const sid = await ensureId();
      const saved = await library.patchSongbook(sid, { [kind]: text });
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

  /** The lyrics looked up now; found and timed, the chords come back timed with them. */
  const lookUpLyrics = async (sid: string) => {
    setLooking(true);
    onStatus(l.lookingForLyrics);
    try {
      const after = await library.lookUpLyrics(sid);
      setSong(after);
      onStatus(after.lyrics ? l.lyricsFound : l.lyricsNotFound);
      if (after.lyrics) onSaved();
    } catch (e) {
      onStatus((e as Error).message);
    } finally {
      setLooking(false);
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
        setSong(await library.addSheet(sid, file, mime));
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
      const after = await library.removeSheet(id, sheet);
      setSong(after);
      if (!after.facts.sheets.length) setTab("info");
      onSaved();
    } catch (e) {
      onStatus((e as Error).message);
    }
  };

  const label: Record<Tab, string> = {
    info: l.tabInfo,
    lyrics: l.tabLyrics,
    chords: l.tabChords,
    tablature: l.tabTablature,
    sheet: l.tabSheet,
  };
  const current: Tab = tab !== "info" && !shown.includes(tab) ? "info" : tab;

  const info = entry.meta?.master ? (
    <SongTagsForm folder={entry.path} onSaved={onSaved} onStatus={onStatus} />
  ) : (
    <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
      {l.noMaster}
    </div>
  );

  // Offered only where the host can draw what they add.
  const adds = songAttachment && (
    <div className="flex flex-wrap gap-2 px-3 pt-2">
      {!has.lyrics && editing !== "lyrics" && (
        <Button
          variant="secondary"
          size="sm"
          disabled={looking}
          onClick={() => startTyping("lyrics")}
        >
          {looking ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <MicVocal className="mr-1 h-3.5 w-3.5" />
          )}
          {looking ? l.lookingForLyrics : l.addLyrics}
        </Button>
      )}
      {!has.chords && editing !== "chords" && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => startTyping("chords")}
        >
          <Music className="mr-1 h-3.5 w-3.5" /> {l.addChords}
        </Button>
      )}
      {!has.tablature && editing !== "tablature" && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => startTyping("tablature")}
        >
          <Guitar className="mr-1 h-3.5 w-3.5" /> {l.addTab}
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={sending}
        onClick={() => sheetInput.current?.click()}
      >
        {sending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileMusic className="mr-1 h-3.5 w-3.5" />
        )}
        {sending ? l.sendingSheets : l.addSheet}
      </Button>
      <input
        ref={sheetInput}
        type="file"
        multiple
        accept={SHEET_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared at once, or picking the same file again after an error emits no change.
          e.target.value = "";
          if (files.length) void sendSheets(files);
        }}
      />
    </div>
  );

  const typed = (kind: Typed) => {
    const text = song?.[kind] ?? "";
    const placeholder = {
      lyrics: l.placeholderLyrics,
      chords: l.placeholderChords,
      tablature: l.placeholderTab,
    }[kind];
    if (editing === kind)
      return (
        <SongTextEditor
          initial={text}
          placeholder={placeholder}
          onSave={(t) => saveText(kind, t)}
          onCancel={cancelTyping}
        />
      );
    return (
      <div className="flex flex-col gap-2 p-4">
        <Button
          variant="outline"
          size="sm"
          className="self-end"
          onClick={() => startTyping(kind)}
        >
          {l.editText}
        </Button>
        {songAttachment?.({ kind, text, sheets: [], sheetUrl: () => "" })}
      </div>
    );
  };

  const body =
    current === "info"
      ? info
      : current !== "sheet"
        ? typed(current)
        : song &&
          songAttachment && (
            <div className="p-4">
              {songAttachment({
                kind: current,
                text: "",
                sheets: song.facts.sheets.map(({ id: sid, name, mime }) => ({
                  id: sid,
                  name,
                  mime,
                })),
                sheetUrl: (sid) => {
                  const sheet = song.facts.sheets.find((s) => s.id === sid);
                  return library.fileUrl(`${song.path}/${sheet?.file ?? ""}`);
                },
                onDeleteSheet: removeSheet,
              })}
            </div>
          );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {adds}
      {/* No tab bar for one tab: a song with nothing added shows its tags alone. */}
      {shown.length > 0 && (
        <Tabs value={current} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="mx-3 mt-2">
            {(["info", ...shown] as Tab[]).map((t) => (
              <TabsTrigger key={t} value={t}>
                {label[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}
