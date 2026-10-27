// SongInfoTabs.tsx — the song screen's left half: its tags, then a tab per attachment it carries —
// lyrics, tablature, sheets — drawn by the host exactly as the songbook draws them. A song with
// none shows its tags alone, with no tab bar for one tab (../docs/songPlayer.md).

import { Tabs, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import type { MediatekEntry, SongbookSong } from "@studio/mediatek/types";
import { useEffect, useState } from "react";
import { library } from "./api";
import { type SongAttachmentView, useLabels, useLibraryHost } from "./host";
import { SongTagsForm } from "./SongTagsForm";

type Tab = "info" | SongAttachmentView["kind"];

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
  const id = typeof meta.uuid === "string" ? meta.uuid : "";
  // What the listing says the song carries — enough to draw the tabs before the texts arrive.
  const kinds: SongAttachmentView["kind"][] = [
    ...(meta.lyrics ? (["lyrics"] as const) : []),
    ...(meta.tabs ? (["tablature"] as const) : []),
    ...(typeof meta.sheets === "number" && meta.sheets > 0
      ? (["sheet"] as const)
      : []),
  ];
  const shown = songAttachment && id ? kinds : [];
  const [tab, setTab] = useState<Tab>("info");
  const [song, setSong] = useState<SongbookSong | null>(null);

  // A new song opens on its tags; the texts are read again whenever the listing says the folder moved.
  useEffect(() => {
    setTab("info");
  }, []);
  const wanted = shown.length > 0;
  useEffect(() => {
    if (!wanted) {
      setSong(null);
      return;
    }
    let alive = true;
    void library
      .songbook(id)
      .then((s) => alive && setSong(s))
      .catch((e: Error) => alive && onStatus(e.message));
    return () => {
      alive = false;
    };
  }, [id, wanted, onStatus]);

  const label: Record<Tab, string> = {
    info: l.tabInfo,
    lyrics: l.tabLyrics,
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
  if (!shown.length) return info;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={current} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mx-3 mt-2">
          {(["info", ...shown] as Tab[]).map((t) => (
            <TabsTrigger key={t} value={t}>
              {label[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-auto">
        {current === "info"
          ? info
          : song &&
            songAttachment && (
              <div className="p-4">
                {songAttachment({
                  kind: current,
                  text: current === "lyrics" ? song.lyrics : song.tablature,
                  sheets: song.facts.sheets.map(({ id: sid, name, mime }) => ({
                    id: sid,
                    name,
                    mime,
                  })),
                  sheetUrl: (sid) => {
                    const sheet = song.facts.sheets.find((s) => s.id === sid);
                    return library.fileUrl(`${song.path}/${sheet?.file ?? ""}`);
                  },
                })}
              </div>
            )}
      </div>
    </div>
  );
}
