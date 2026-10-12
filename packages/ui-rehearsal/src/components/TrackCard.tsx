// TrackCard.tsx — one playable thing in a card: a version on the release page, a release on a page,
// public or not. One head row (title, badges, an optional version picker, a ⋮) over its waveform.
// What differs between those screens is passed in as options; every verb goes in the ⋮, not a button.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { EllipsisVertical } from "@frediverse/ui/icons";
import type { ReactNode } from "react";
import type { SongEnvelope } from "../types";
import { WaveformPlayer } from "./WaveformPlayer";

export interface TrackMenuEntry {
  label: ReactNode;
  /** An action; an entry with `href` is a plain download link instead. */
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A rule above the entry, to set a group apart. */
  separatorBefore?: boolean;
}

export interface TrackPicker {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

interface Props {
  title: ReactNode;
  /** Shown after the title: a version's "default" and "hidden". */
  badges?: ReactNode;
  /** The version dropdown; left out when there is nothing to choose. */
  picker?: TrackPicker;
  /** Something that must stay visible to a visitor, before the ⋮ — the public page's Download. */
  actions?: ReactNode;
  /** The ⋮; no entries, no ⋮. */
  menu?: TrackMenuEntry[];
  menuLabel: string;
  audio: { src: string; shapeOf: () => Promise<SongEnvelope> } | null;
  dimmed?: boolean;
}

export function TrackCard({
  title,
  badges,
  picker,
  actions,
  menu = [],
  menuLabel,
  audio,
  dimmed,
}: Props) {
  return (
    <Card className={`track-card${dimmed ? " version-hidden" : ""}`}>
      <div className="version-head">
        <span className="version-name">{title}</span>
        {badges}
        {picker && (
          <select
            aria-label={picker.label}
            value={picker.value}
            onChange={(e) => picker.onChange(e.target.value)}
          >
            {picker.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {actions}
        {menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ds-button"
                title={menuLabel}
                aria-label={menuLabel}
              >
                <EllipsisVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="rehearsal-root" align="end">
              {menu.map((e, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the entries are a fixed list per render.
                <MenuEntry key={i} entry={e} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {audio && (
        // Keyed on the source, so another version or a replaced file starts a fresh player.
        <WaveformPlayer
          key={audio.src}
          src={audio.src}
          shapeOf={audio.shapeOf}
        />
      )}
    </Card>
  );
}

function MenuEntry({ entry: e }: { entry: TrackMenuEntry }) {
  const className = e.danger ? "text-destructive" : undefined;
  return (
    <>
      {e.separatorBefore && <DropdownMenuSeparator />}
      {e.href ? (
        <DropdownMenuItem asChild className={className} disabled={e.disabled}>
          <a href={e.href} download>
            {e.label}
          </a>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          className={className}
          disabled={e.disabled}
          onSelect={e.onSelect}
        >
          {e.label}
        </DropdownMenuItem>
      )}
    </>
  );
}
