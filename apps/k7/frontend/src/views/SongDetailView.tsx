import { Button } from "@frediverse/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { Textarea } from "@frediverse/ui/textarea";
import {
  ChordSheet,
  collectChords,
  lineAt,
  timingsByLine,
  transposeChord,
} from "@k7/lyrics";
import { Tablature } from "@k7/tablature";
import { Pencil, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChordPopin } from "../components/ChordPopin";
import { ChordsPanel } from "../components/ChordsPanel";
import { MetronomeWidget } from "../components/MetronomeWidget";
import { OptionsPanel } from "../components/OptionsPanel";
import { SheetPanel } from "../components/SheetPanel";
import { SongFetchInsert } from "../components/SongFetchInsert";
import { SongMenu } from "../components/SongMenu";
import { SongPlayer } from "../components/SongPlayer";
import { TimedLyricsDialog } from "../components/TimedLyricsDialog";
import { fmtDate } from "../format";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { hasContent, SONG_TABS, visibleTabs } from "../songTabs";
import type { LrcCandidate, LyricTiming, Song, SongTab } from "../types";

interface Props {
  song: Song;
  initialTab?: SongTab;
  onSave: (field: "lyrics" | "tablature", value: string) => Promise<void>;
  onUploadSheets: (files: File[]) => Promise<void>;
  onDeleteSheet: (fileId: string) => Promise<void>;
  sheetUrl: (fileId: string) => string;
  /** "Replace the track…" in the ⋮ menu — the insert's own upload goes through onUpload instead. */
  onUploadAudio: (file: File) => Promise<void>;
  onDeleteAudio: () => Promise<void>;
  audioUrl: string;
  onToggleFavorite: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** Save an LRC's outcome: new lyrics (or null to keep them) and the line timecodes. */
  onLrc: (lyrics: string | null, timings: LyricTiming[]) => Promise<void>;
  /** Timed lyrics for this song on LRCLIB, ranked by the track's length when it is known. */
  onFindLrc: (duration?: number) => Promise<LrcCandidate[]>;
  /** Retries the instrumental once no engine was online. */
  onMixInstrumental: (folder: string) => Promise<Song>;
  instrumentalUrl: string;
  /** The auto-fetch insert under the title: start a Soulseek hunt, or hand it an uploaded file. */
  onDownload: () => void;
  onUpload: (file: File) => void;
}

export function SongDetailView({
  song,
  initialTab,
  onSave,
  onUploadSheets,
  onDeleteSheet,
  sheetUrl,
  onUploadAudio,
  onDeleteAudio,
  audioUrl,
  onToggleFavorite,
  onDelete,
  onLrc,
  onFindLrc,
  onMixInstrumental,
  instrumentalUrl,
  onDownload,
  onUpload,
}: Props) {
  // Shared by the ⋮ menu's "Add timed lyrics…" and the insert's "Fix the lyrics" — one dialog.
  const [timedOpen, setTimedOpen] = useState(false);
  // A tab asked for by the address but still empty is one being added: it opens on its editor.
  const [adding, setAdding] = useState<SongTab | null>(() =>
    initialTab && initialTab !== "sheet" && !hasContent(song, initialTab)
      ? initialTab
      : null,
  );
  const [chosen, setChosen] = useState<SongTab | null>(initialTab ?? null);
  const tabs = visibleTabs(song, adding);
  // What is drawn follows what exists: a tab whose content went away hands over to the first left.
  const tab: SongTab | null =
    chosen && tabs.includes(chosen) ? chosen : (tabs[0] ?? null);
  // `content` stays a string for the text editor; the sheet tab draws its own panel.
  const content = tab === null || tab === "sheet" ? "" : song[tab];
  // An empty tab opens in the editor; a filled one stays read-only until Edit.
  const [editing, setEditing] = useState(content === "");
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  // Every rail panel opens FOLDED: the page is the song, and a margin full of open drawers is not.
  const [panelOpen, setPanelOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [metroOpen, setMetroOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 760px)");

  // The reference track's playhead, which the timed lyrics follow and seek — ../../../docs/lyricsTiming.md.
  const audio = useRef<HTMLAudioElement>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the track's name is a TRIGGER — a new file is a new element to listen to.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const tick = () => setPlayhead(el.currentTime);
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
    };
  }, [song.audio?.name]);
  const lineTimes = useMemo(
    () => timingsByLine(song.lyrics, song.lyricTimings ?? []),
    [song.lyrics, song.lyricTimings],
  );
  const activeLine =
    playhead === null || playhead === 0 ? null : lineAt(lineTimes, playhead);
  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play();
  };

  // Chords used in the lyrics, in the currently-transposed spelling.
  const chords = useMemo(
    () =>
      tab === "lyrics"
        ? collectChords(content).map((c) => transposeChord(c, transpose))
        : [],
    [tab, content, transpose],
  );

  // Reset the editor whenever the shown tab (or the reloaded song) changes.
  useEffect(() => {
    setDraft(content);
    setEditing(content === "");
    setTranspose(0);
    setSelectedChord(null);
  }, [song, tab, content]);

  // Once the kind being added holds something, it is an ordinary tab.
  useEffect(() => {
    if (adding && hasContent(song, adding)) setAdding(null);
  }, [song, adding]);

  const add = (key: SongTab) => {
    setAdding(key);
    setChosen(key);
  };

  const save = async () => {
    if (tab === null || tab === "sheet") return; // sheet has no text editor
    setSaving(true);
    try {
      await onSave(tab, draft);
      // The reloaded song comes back through the effect above, into the read-only view.
    } finally {
      setSaving(false);
    }
  };

  // Leaving an empty tab being added takes it away again, rather than leaving an empty editor behind.
  const cancel = () => {
    if (content === "" && tab === adding) {
      setAdding(null);
      setChosen(null);
      return;
    }
    setDraft(content);
    setEditing(content === "");
  };

  const remove = async () => {
    if (!confirm("Delete this song?")) return;
    await onDelete();
  };

  return (
    <div className="song-detail">
      <div className="song-detail-head">
        <h2>{song.title}</h2>
        {/* Beside the title, and it takes the slack: that is what puts the star next to the ⋮. */}
        <span className="muted song-detail-artist">{song.artist}</span>
        <button
          className={`star-btn${song.favorite ? " on" : ""}`}
          onClick={onToggleFavorite}
          title={song.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={song.favorite}
        >
          <Star className={`size-5${song.favorite ? " fill-current" : ""}`} />
        </button>
        {/* Everything this song can be GIVEN, in one menu rather than a row of links. */}
        <SongMenu
          song={song}
          has={(key) => hasContent(song, key)}
          onAdd={add}
          onUploadSheets={async (files) => {
            await onUploadSheets(files);
            setChosen("sheet");
          }}
          onUploadAudio={onUploadAudio}
          onDeleteAudio={onDeleteAudio}
          onOpenTimedLyrics={() => setTimedOpen(true)}
          onMixInstrumental={onMixInstrumental}
          onDelete={remove}
        />
      </div>

      <SongFetchInsert
        song={song}
        onDownload={onDownload}
        onUpload={onUpload}
        onFixLyrics={() => setTimedOpen(true)}
      />
      <TimedLyricsDialog
        open={timedOpen}
        onOpenChange={setTimedOpen}
        lyrics={song.lyrics}
        onFindLrc={onFindLrc}
        trackSeconds={() => audio.current?.duration || undefined}
        onSave={async (lyrics, timings) => {
          await onLrc(lyrics, timings);
          setChosen("lyrics");
        }}
      />

      {tabs.length > 1 && tab !== null && (
        <Tabs value={tab} onValueChange={(v) => setChosen(v as SongTab)}>
          <TabsList className="mb-3.5">
            {SONG_TABS.filter(({ key }) => tabs.includes(key)).map(
              ({ key, label }) => (
                <TabsTrigger key={key} value={key}>
                  {label}
                </TabsTrigger>
              ),
            )}
          </TabsList>
        </Tabs>
      )}

      {tab === null ? null : tab === "sheet" ? (
        <SheetPanel
          sheets={song.sheets}
          urlFor={sheetUrl}
          onDelete={onDeleteSheet}
        />
      ) : editing ? (
        <>
          <Textarea
            className="song-editor"
            value={draft}
            spellCheck={false}
            autoFocus
            placeholder={`Type the ${tab} here…`}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <Button disabled={saving || draft === content} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {(content !== "" || tab === adding) && (
              <Button variant="outline" disabled={saving} onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {tab === "lyrics" ? (
            <>
              <ChordSheet
                text={content}
                transpose={transpose}
                onChordClick={setSelectedChord}
                timings={lineTimes}
                activeLine={activeLine}
                onLineClick={song.audio ? seek : undefined}
              />
              {/* A narrow screen has no rail, so a tapped chord opens over the sheet instead. */}
              {isMobile && chords.length > 0 && selectedChord && (
                <ChordPopin
                  symbol={selectedChord}
                  onClose={() => setSelectedChord(null)}
                />
              )}
            </>
          ) : (
            <Tablature text={content} />
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit {tab}
            </Button>
          </div>
        </>
      )}

      <p className="muted small">Added {fmtDate(song.createdAt)}</p>

      {/* Mounted ONCE and for every screen: a rail down the margin, a bar at the foot of a phone. */}
      <aside className="side-rail">
        {/* First, because it changes what you are READING rather than what is playing. */}
        {tab === "lyrics" && !editing && (
          <OptionsPanel
            transpose={transpose}
            onTranspose={(next) => setTranspose(next)}
            open={optionsOpen}
            onToggle={() => setOptionsOpen((o) => !o)}
          />
        )}
        <SongPlayer
          song={song}
          audioUrl={audioUrl}
          audioRef={audio}
          instrumentalUrl={instrumentalUrl}
          transpose={transpose}
          floating
          open={playerOpen}
          onToggle={() => setPlayerOpen((o) => !o)}
        />
        {chords.length > 0 && !editing && (
          <ChordsPanel
            chords={chords}
            selected={selectedChord}
            open={panelOpen}
            onToggle={() => setPanelOpen((o) => !o)}
          />
        )}
        {/* Last, and always there: a click track belongs to no one tab. */}
        <MetronomeWidget
          open={metroOpen}
          onToggle={() => setMetroOpen((o) => !o)}
        />
      </aside>
    </div>
  );
}
