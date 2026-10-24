import { Button } from "@frediverse/ui/button";
import { Headphones, Pencil, Star } from "@frediverse/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { Textarea } from "@frediverse/ui/textarea";
import {
  ChordSheet,
  collectChords,
  hasTimecodes,
  lineAt,
  timecodesByLine,
  timingsByLine,
  transposeChord,
} from "@studio/lyrics";
import { Tablature } from "@studio/tablature";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackButton } from "../components/BackButton";
import { ChordPopin } from "../components/ChordPopin";
import { ChordsPanel } from "../components/ChordsPanel";
import { MetronomeWidget } from "../components/MetronomeWidget";
import { OptionsPanel } from "../components/OptionsPanel";
import { SheetPanel } from "../components/SheetPanel";
import { SongBar } from "../components/SongBar";
import { SongFetchInsert } from "../components/SongFetchInsert";
import { SongMenu } from "../components/SongMenu";
import { confirmLoss } from "../confirm";
import { fmtDate } from "../format";
import { useLyricsLead } from "../hooks/useLyricsLead";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { m } from "../paraglide/messages.js";
import { hasContent, SONG_TABS, visibleTabs } from "../songTabs";
import type { Song, SongTab } from "../types";

/** A server's host, for a sentence naming where a copy came from. */
const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

interface Props {
  song: Song;
  initialTab?: SongTab;
  onSave: (field: "lyrics" | "tablature", value: string) => Promise<void>;
  onUploadSheets: (files: File[]) => Promise<void>;
  onDeleteSheet: (fileId: string) => Promise<void>;
  sheetUrl: (fileId: string) => string;
  /** "Add a track…" in the ⋮ menu — the insert's own upload goes through onUpload instead. */
  onUploadAudio: (file: File) => Promise<void>;
  onToggleFavorite: () => Promise<void>;
  onDelete: () => Promise<void>;
  /** Retries the instrumental once no engine was online. */
  onMixInstrumental: (folder: string) => Promise<Song>;
  /** The auto-fetch insert under the title: start a Soulseek hunt, or hand it an uploaded file. */
  onDownload: () => void;
  onUpload: (file: File) => void;
  /** "Ignore": dismiss the insert for this song for good. */
  onIgnore: () => void;
  /** The insert's Retry: runs the pipeline again from wherever the song stands. */
  onRerun: () => void;
  /** The ⋮ menu's re-run: unlinks the library track, then runs the whole pipeline again. */
  onRestart: () => void;
  /** Takes the timecodes off the lyrics and times them off LRCLIB again. */
  onResyncLyrics: () => void;
  /** Saves a new artist and title, from the ⋮ menu's popin. */
  onRename: (artist: string, title: string) => Promise<void>;
  /** Clears a stored pipeline failure without retrying. */
  onDismissFailure: () => void;
  /** The song is being taken from the library on its own: the insert shows that, not a choice. */
  fromLibrary: boolean;
  onBack: () => void;
}

export function SongDetailView({
  song,
  initialTab,
  onSave,
  onUploadSheets,
  onDeleteSheet,
  sheetUrl,
  onUploadAudio,
  onToggleFavorite,
  onDelete,
  onMixInstrumental,
  onDownload,
  onUpload,
  onIgnore,
  onRerun,
  onRestart,
  onResyncLyrics,
  onRename,
  onDismissFailure,
  fromLibrary,
  onBack,
}: Props) {
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
  // A copy of a server's song reads here and is edited there — ../../../rehearsal-server/docs/songbookCopy.md.
  const readOnly = song.origin !== "";
  const [editingState, setEditing] = useState(content === "");
  const editing = editingState && !readOnly;
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  // Every rail panel opens FOLDED: the page is the song, and a margin full of open drawers is not.
  const [panelOpen, setPanelOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [metroOpen, setMetroOpen] = useState(false);
  // The track's bar is up from the start: closing it silences the track, and playing brings it back.
  const [barOpen, setBarOpen] = useState(true);
  const isMobile = useMediaQuery("(max-width: 760px)");

  // The reference track's playhead, which the timed lyrics follow and seek — ../../docs/lyricsTiming.md.
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
    // The `{{MM:SS.cc}}` in the text; a song timed before those were written keeps its side-by-side timings.
    () =>
      hasTimecodes(song.lyrics)
        ? timecodesByLine(song.lyrics)
        : timingsByLine(song.lyrics, song.lyricTimings ?? []),
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
  // A clicked line starts this many seconds early, so its first word is not clipped.
  const [lyricsLead, setLyricsLead] = useLyricsLead();

  // Chords used in the lyrics, in the currently-transposed spelling.
  const chords = useMemo(
    () =>
      tab === "lyrics"
        ? collectChords(content).map((c) => transposeChord(c, transpose))
        : [],
    [tab, content, transpose],
  );

  // A different song or tab resets the editor; new content alone refreshes the draft only while nobody is typing — a pipeline's status poll replaces `song` every 2 s.
  const shown = useRef({ id: song.id, tab });
  useEffect(() => {
    const moved = shown.current.id !== song.id || shown.current.tab !== tab;
    shown.current = { id: song.id, tab };
    if (moved) {
      setDraft(content);
      setEditing(content === "");
      setTranspose(0);
      setSelectedChord(null);
    } else if (!editing) {
      setDraft(content);
      if (content === "") setEditing(true);
    }
  }, [song.id, tab, content, editing]);

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
      // Saved: the editor closes on the rendered sheet, and the reloaded song refreshes it through the effect above.
      setEditing(draft === "");
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
    const asked = readOnly
      ? m["song.confirmRemoveCopy"]({ server: hostOf(song.origin) })
      : m["song.confirmDelete"]();
    if (!(await confirmLoss(asked))) return;
    await onDelete();
  };

  return (
    <div
      className={`song-detail${song.audio && barOpen ? " has-song-bar" : ""}`}
    >
      <div className="song-detail-head">
        <BackButton to={m["nav.songbook"]()} onClick={onBack} />
        <h2>{song.title}</h2>
        {/* Beside the title, and it takes the slack: that is what puts the star next to the ⋮. */}
        <span className="muted song-detail-artist">{song.artist}</span>
        <button
          type="button"
          className={`star-btn${song.favorite ? " on" : ""}`}
          onClick={onToggleFavorite}
          title={song.favorite ? m["song.unfavorite"]() : m["song.favorite"]()}
          aria-pressed={song.favorite}
        >
          <Star className={`size-5${song.favorite ? " fill-current" : ""}`} />
        </button>
        {/* The way back to a closed bar, and the only play button the page has without it. */}
        {song.audio && !barOpen && (
          <button
            type="button"
            className="star-btn"
            onClick={() => void audio.current?.play()}
            title={m["player.show"]()}
            aria-label={m["player.show"]()}
          >
            <Headphones className="size-5" />
          </button>
        )}
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
          onMixInstrumental={onMixInstrumental}
          onRerun={onRestart}
          onResyncLyrics={onResyncLyrics}
          onRename={onRename}
          onDelete={remove}
        />
      </div>

      {readOnly ? (
        <p className="muted small">
          {m["song.copyOf"]({ server: hostOf(song.origin) })}
        </p>
      ) : (
        <SongFetchInsert
          song={song}
          onDownload={onDownload}
          onUpload={onUpload}
          onIgnore={onIgnore}
          onRetry={onRerun}
          onDismiss={onDismissFailure}
          fromLibrary={fromLibrary}
        />
      )}

      {tabs.length > 1 && tab !== null && (
        <Tabs value={tab} onValueChange={(v) => setChosen(v as SongTab)}>
          <TabsList className="mb-3.5">
            {SONG_TABS.filter(({ key }) => tabs.includes(key)).map(
              ({ key, label }) => (
                <TabsTrigger key={key} value={key}>
                  {label()}
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
          onDelete={readOnly ? undefined : onDeleteSheet}
        />
      ) : editing ? (
        <>
          <Textarea
            className="song-editor"
            value={draft}
            spellCheck={false}
            autoFocus
            aria-label={
              tab === "lyrics"
                ? m["song.tab.lyrics"]()
                : m["song.tab.tablatureFull"]()
            }
            placeholder={
              tab === "lyrics"
                ? m["song.placeholder.lyrics"]()
                : m["song.placeholder.tablature"]()
            }
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* The timecodes are part of this text — the one place they are seen, typed and fixed (../../docs/lyricsTiming.md). */}
          {tab === "lyrics" && (
            <p className="muted small" style={{ marginTop: 6 }}>
              {m["song.timecodeHint"]({ code: "{{MM:SS}}" })}
            </p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Button disabled={saving || draft === content} onClick={save}>
              {saving ? m["common.saving"]() : m["common.save"]()}
            </Button>
            {(content !== "" || tab === adding) && (
              <Button variant="outline" disabled={saving} onClick={cancel}>
                {m["common.cancel"]()}
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
                onLineClick={
                  song.audio
                    ? (t: number) => seek(Math.max(0, t - lyricsLead))
                    : undefined
                }
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
          {!readOnly && (
            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />{" "}
                {tab === "lyrics"
                  ? m["song.edit.lyrics"]()
                  : m["song.edit.tablature"]()}
              </Button>
            </div>
          )}
        </>
      )}

      <p className="muted small">
        {m["song.added"]({ at: fmtDate(song.createdAt) })}
      </p>

      {/* Mounted ONCE and for every screen: a rail down the margin, a bar at the foot of a phone. */}
      <aside className="side-rail">
        {/* First, because it changes what you are READING rather than what is playing. */}
        {tab === "lyrics" && !editing && (
          <OptionsPanel
            transpose={transpose}
            onTranspose={(next) => setTranspose(next)}
            lyricsLead={lyricsLead}
            onLyricsLead={setLyricsLead}
            open={optionsOpen}
            onToggle={() => setOptionsOpen((o) => !o)}
          />
        )}
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

      {/* Outside the rail: the mini player is the page's transport, not one of its drawers. */}
      <SongBar
        song={song}
        audioRef={audio}
        transpose={transpose}
        open={barOpen}
        onPlay={() => setBarOpen(true)}
        onClose={() => setBarOpen(false)}
      />
    </div>
  );
}
