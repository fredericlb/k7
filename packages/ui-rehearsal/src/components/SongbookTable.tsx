// The songbook as a table: favourite, public or private, artist, title, then a link to each text the song has.
// A click anywhere on a row opens the song; the star and the links act on their own and stop there.

import { Button } from "@frediverse/ui/button";
import {
  FileMusic,
  Globe,
  Guitar,
  Lock,
  MicVocal,
  Star,
} from "@frediverse/ui/icons";
import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";
import type { Song, SongTab } from "../types";
import { SongPlacementIcon, type useSongbookCopy } from "./SongbookServerCopy";

interface Props {
  songs: Song[];
  /** Drawn at the right end of the header row — the songbook's ⋮ menu. */
  headerMenu?: ReactNode;
  /** Where each song lives on a machine paired with a server; absent, nothing is drawn. */
  copy?: ReturnType<typeof useSongbookCopy>;
  onOpenSong: (s: Song, tab?: SongTab) => void;
  onToggleSongFavorite: (s: Song) => void;
}

const LINKS = [
  [
    "lyrics",
    MicVocal,
    m["song.tab.lyrics"],
    m["songbook.open.lyrics"],
    m["songbook.none.lyrics"],
  ],
  [
    "tablature",
    Guitar,
    m["song.tab.tablature"],
    m["songbook.open.tablature"],
    m["songbook.none.tablature"],
  ],
  [
    "sheet",
    FileMusic,
    m["song.tab.sheet"],
    m["songbook.open.sheet"],
    m["songbook.none.sheet"],
  ],
] as const;

export function SongbookTable({
  songs,
  headerMenu,
  copy,
  onOpenSong,
  onToggleSongFavorite,
}: Props) {
  if (songs.length === 0)
    return (
      <p className="home-list-empty muted small">{m["songbook.empty"]()}</p>
    );

  return (
    <div className="songbook-table-wrap">
      <table className="songbook-table">
        <thead>
          <tr>
            <th className="songbook-star">
              <span className="sr-only">{m["song.favorite"]()}</span>
            </th>
            <th className="songbook-visibility">
              <span className="sr-only">{m["songbook.visibility"]()}</span>
            </th>
            <th>{m["field.artist"]()}</th>
            <th>{m["field.title"]()}</th>
            <th className="songbook-links-head">
              <span className="sr-only">{m["songbook.links"]()}</span>
              {headerMenu}
            </th>
          </tr>
        </thead>
        <tbody>
          {songs.map((s) => (
            <tr
              key={s.id}
              className={s.favorite ? "favorite" : undefined}
              onClick={() => onOpenSong(s)}
            >
              <td className="songbook-star">
                <button
                  type="button"
                  className={`star-btn${s.favorite ? " on" : ""}`}
                  title={
                    s.favorite ? m["song.unfavorite"]() : m["song.favorite"]()
                  }
                  aria-pressed={s.favorite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSongFavorite(s);
                  }}
                >
                  <Star
                    className={`size-4${s.favorite ? " fill-current" : ""}`}
                  />
                </button>
              </td>
              <td className="songbook-visibility">
                <span
                  className={`songbook-visibility-icon${s.private ? " private" : ""}`}
                  title={s.private ? m["song.private"]() : m["song.public"]()}
                  role="img"
                  aria-label={
                    s.private ? m["song.private"]() : m["song.public"]()
                  }
                >
                  {s.private ? (
                    <Lock className="size-4" />
                  ) : (
                    <Globe className="size-4" />
                  )}
                </span>
                <SongPlacementIcon
                  state={copy?.stateOf(s.id) ?? null}
                  placement={copy?.placement ?? null}
                />
              </td>
              {/* Cut with … when too long, so a narrow screen never scrolls sideways; the tooltip has it whole. */}
              <td className="songbook-artist" title={s.artist}>
                {s.artist}
              </td>
              <td className="songbook-title" title={s.title}>
                {s.title}
              </td>
              <td className="songbook-links">
                <div className="song-links">
                  {LINKS.map(([key, Icon, label, open, none]) => {
                    const filled =
                      key === "sheet"
                        ? s.sheets.length > 0
                        : s[key].trim() !== "";
                    return (
                      <Button
                        key={key}
                        variant="outline"
                        size="sm"
                        className="song-link"
                        disabled={!filled}
                        title={filled ? open() : none()}
                        aria-label={label()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSong(s, key);
                        }}
                      >
                        <Icon className="size-4" />
                        <span className="song-link-label">{label()}</span>
                      </Button>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
