import { Button } from "@frediverse/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { Textarea } from "@frediverse/ui/textarea";
import { ChordSheet, collectChords, transposeChord } from "@k7/lyrics";
import { Tablature } from "@k7/tablature";
import { useEffect, useMemo, useState } from "react";
import { ChordPopin } from "../components/ChordPopin";
import { ChordsPanel } from "../components/ChordsPanel";
import { MetronomeWidget } from "../components/MetronomeWidget";
import { SheetPanel } from "../components/SheetPanel";
import { SongPlayer } from "../components/SongPlayer";
import { fmtDate } from "../format";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { Song, SongTab } from "../types";

const TABS: { key: SongTab; label: string }[] = [
  { key: "lyrics", label: "Lyrics" },
  { key: "tablature", label: "Tablature" },
  { key: "sheet", label: "Sheet" },
];

// Whether a tab holds anything: lyrics and tablature are text, the sheet is a file list.
const hasContent = (song: Song, key: SongTab): boolean =>
  key === "sheet" ? song.sheets.length > 0 : song[key] !== "";

interface Props {
  song: Song;
  initialTab?: SongTab;
  onSave: (field: "lyrics" | "tablature", value: string) => Promise<void>;
  onUploadSheets: (files: File[]) => Promise<void>;
  onDeleteSheet: (fileId: string) => Promise<void>;
  sheetUrl: (fileId: string) => string;
  onUploadAudio: (file: File) => Promise<void>;
  onDeleteAudio: () => Promise<void>;
  audioUrl: string;
  onToggleFavorite: () => Promise<void>;
  onDelete: () => Promise<void>;
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
}: Props) {
  // Unasked, open the first tab with content: a song that is only a tablature lands there.
  const [tab, setTab] = useState<SongTab>(
    () =>
      initialTab ??
      TABS.find(({ key }) => hasContent(song, key))?.key ??
      "lyrics",
  );
  // `content` stays a string for the text editor; the sheet tab draws its own panel.
  const content = tab === "sheet" ? "" : song[tab];
  // An empty tab opens in the editor; a filled one stays read-only until Edit.
  const [editing, setEditing] = useState(content === "");
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const isMobile = useMediaQuery("(max-width: 760px)");

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

  const save = async () => {
    if (tab === "sheet") return; // sheet has no text editor
    setSaving(true);
    try {
      await onSave(tab, draft);
      // The reloaded song comes back through the effect above, into the read-only view.
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
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
        <button
          className={`star-btn${song.favorite ? " on" : ""}`}
          onClick={onToggleFavorite}
          title={song.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={song.favorite}
        >
          {song.favorite ? "★" : "☆"}
        </button>
      </div>
      <p className="muted">{song.artist}</p>

      {/* Above the tabs on purpose: you play along to it whichever one you are reading. */}
      <SongPlayer
        song={song}
        audioUrl={audioUrl}
        onUpload={onUploadAudio}
        onDelete={onDeleteAudio}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as SongTab)}>
        <TabsList className="mb-3.5">
          {TABS.map(({ key, label }) => (
            <TabsTrigger key={key} value={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "sheet" ? (
        <SheetPanel
          sheets={song.sheets}
          urlFor={sheetUrl}
          onUpload={onUploadSheets}
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
            {content !== "" && (
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
              <div className="cs-transpose">
                <span className="muted small">Transpose</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTranspose((t) => t - 1)}
                  title="Down a semitone"
                >
                  −
                </Button>
                <span className="cs-transpose-val">
                  {transpose === 0
                    ? "0"
                    : `${transpose > 0 ? "♯" : "♭"}${Math.abs(transpose)}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTranspose((t) => t + 1)}
                  title="Up a semitone"
                >
                  +
                </Button>
                {transpose !== 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTranspose(0)}
                    title="Reset to original key"
                  >
                    Reset
                  </Button>
                )}
              </div>
              <ChordSheet
                text={content}
                transpose={transpose}
                onChordClick={setSelectedChord}
              />
              {chords.length > 0 &&
                (isMobile ? (
                  selectedChord && (
                    <ChordPopin
                      symbol={selectedChord}
                      onClose={() => setSelectedChord(null)}
                    />
                  )
                ) : (
                  <ChordsPanel
                    chords={chords}
                    selected={selectedChord}
                    open={panelOpen}
                    onToggle={() => setPanelOpen((o) => !o)}
                  />
                ))}
            </>
          ) : tab === "tablature" ? (
            <Tablature text={content} />
          ) : (
            <pre className="song-editor song-view">{content}</pre>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Button variant="outline" onClick={() => setEditing(true)}>
              ✎ Edit {tab}
            </Button>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <Button variant="outline" size="sm" onClick={remove}>
          🗑 Delete song
        </Button>
      </div>

      <p className="muted small">Added {fmtDate(song.createdAt)}</p>

      <MetronomeWidget />
    </div>
  );
}
