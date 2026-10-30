// SongInfoTabs.tsx — the song page's one column of tabs: its info (the tags, over a pane of the waveform
// and its versions), then a tab per attachment it carries — lyrics, chords, their diagrams, tablature, sheets —
// drawn by the host exactly as the songbook draws them. The lyrics and chords follow the track.
// What adds an attachment is the header's menu (SongMenu.tsx). See ../docs/songPlayer.md.

import { Button } from "@frediverse/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useMemo } from "react";
import { library } from "./api";
import { BottomSplit } from "./BottomSplit";
import { FollowedText } from "./FollowedText";
import { useLabels, useLibraryHost } from "./host";
import { SongPlayer } from "./SongPlayer";
import { SongTagsForm } from "./SongTagsForm";
import { SongTextEditor } from "./SongTextEditor";
import { SongVariants } from "./SongVariants";
import { songChords } from "./songExtras";
import type {
  AttachmentKind,
  SongAttachments,
  SongTab,
  Typed,
} from "./useSongAttachments";
import type { SongTransport } from "./useSongTransport";

export function SongInfoTabs({
  entry,
  attachments: a,
  transport,
  transpose,
  onSaved,
  onStatus,
  onRemoveVariant,
}: {
  entry: MediatekEntry;
  attachments: SongAttachments;
  transport: SongTransport;
  transpose: number;
  onSaved: () => void;
  onStatus: (status: string) => void;
  /** Absent, the variants are listed read-only. */
  onRemoveVariant?: (name: string) => void;
}) {
  const l = useLabels().song;
  const { songAttachment } = useLibraryHost();
  const { song, has, editing, tab } = a;

  const order: AttachmentKind[] = ["lyrics", "chords", "tablature", "sheet"];
  // A text being typed for the first time has its tab already, so the editor has somewhere to be.
  const carried = songAttachment
    ? order.filter((k) => has[k] || k === editing)
    : [];
  // Chords from chords.txt and the lyrics' inline ones, both: either may be all the song has.
  const chords = useMemo(
    () => songChords(song?.chords ?? "", song?.lyrics ?? "", transpose),
    [song?.chords, song?.lyrics, transpose],
  );
  const tabs: SongTab[] = ["info"];
  for (const k of carried) {
    tabs.push(k);
    if (k === "chords" && chords.length) tabs.push("diagrams");
  }
  // Inline chords with no chords.txt still earn the diagrams, placed after the lyrics.
  if (songAttachment && chords.length && !tabs.includes("diagrams"))
    tabs.splice(tabs.indexOf("lyrics") + 1 || tabs.length, 0, "diagrams");
  const current: SongTab = tabs.includes(tab) ? tab : "info";

  const label: Record<SongTab, string> = {
    info: l.tabInfo,
    lyrics: l.tabLyrics,
    chords: l.tabChords,
    diagrams: l.tabDiagrams,
    tablature: l.tabTablature,
    sheet: l.tabSheet,
  };

  const tags = entry.meta?.master ? (
    <SongTagsForm folder={entry.path} onSaved={onSaved} onStatus={onStatus} />
  ) : (
    <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
      {l.noMaster}
    </div>
  );

  const waveform = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SongPlayer entry={entry} transport={transport} />
      </div>
      {entry.variants?.length ? (
        <div className="max-h-[45%] shrink-0 overflow-auto border-t p-3">
          <SongVariants entry={entry} onRemove={onRemoveVariant} />
        </div>
      ) : null}
    </div>
  );

  // The tags over the waveform: what a song IS and what it sounds like, read together (../docs/songPlayer.md).
  const info = (
    <BottomSplit
      top={tags}
      bottom={waveform}
      label={l.waveformPane}
      storageKey="k7.songWaveformShare"
      initial={0.55}
    />
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
          onSave={(t) => a.saveText(kind, t)}
          onCancel={a.cancelTyping}
        />
      );
    return (
      <div className="flex flex-col gap-2 p-4">
        <Button
          variant="outline"
          size="sm"
          className="self-end"
          onClick={() => a.startTyping(kind)}
        >
          {l.editText}
        </Button>
        {songAttachment &&
          (kind === "tablature" ? (
            songAttachment({ kind, text, sheets: [], sheetUrl: () => "" })
          ) : (
            <FollowedText
              kind={kind}
              text={text}
              transpose={transpose}
              transport={transport}
              draw={songAttachment}
            />
          ))}
      </div>
    );
  };

  const sheet = song && songAttachment && (
    <div className="p-4">
      {songAttachment({
        kind: "sheet",
        text: "",
        sheets: song.facts.sheets.map(({ id: sid, name, mime }) => ({
          id: sid,
          name,
          mime,
        })),
        sheetUrl: (sid) => {
          const s = song.facts.sheets.find((x) => x.id === sid);
          return library.fileUrl(`${song.path}/${s?.file ?? ""}`);
        },
        onDeleteSheet: a.removeSheet,
        transpose,
      })}
    </div>
  );

  const diagrams = songAttachment && (
    <div className="p-4">
      {songAttachment({
        kind: "diagrams",
        text: "",
        sheets: [],
        sheetUrl: () => "",
        transpose,
        chords,
      })}
    </div>
  );

  const body =
    current === "info"
      ? info
      : current === "sheet"
        ? sheet
        : current === "diagrams"
          ? diagrams
          : typed(current);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={current} onValueChange={(v) => a.setTab(v as SongTab)}>
        {/* Scrolls sideways on a phone rather than wrapping into a second row. */}
        <TabsList className="mx-3 mt-2 max-w-[calc(100%-1.5rem)] justify-start overflow-x-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t} className="flex-none">
              {label[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div
        className={`min-h-0 flex-1 ${current === "info" ? "overflow-hidden" : "overflow-auto"}`}
      >
        {body}
      </div>
    </div>
  );
}
