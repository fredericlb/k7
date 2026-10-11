// TapWidget.tsx — one sound of a rack, on its node's card: a pad that auditions it and lights when
// its note plays, the NOTE it answers to, and the library SAMPLE it fires. The last tap of a grid adds
// a sound instead. Every edit is only ASKED of the host, which writes the node's file; the card holds
// nothing of its own. See packages/song/docs/racks.md.

import { Plus, Volume2, VolumeX, X } from "@frediverse/ui/icons";
import type { WebRackSound } from "@studio/graph-model";
import { rackAddBind, rackBindSymbol } from "@studio/ui-chains/graph";
import { useState } from "react";
import { ValueEditor } from "./ValueEditor";

/** What a tap asks of its host: the three writes, and the sample picker, which is the host's popup. */
export type TapAction =
  | { kind: "note"; symbol: string; note: number }
  | { kind: "sample"; symbol: string; x: number; y: number }
  | { kind: "add"; note?: number }
  | { kind: "remove"; symbol: string }
  // Silence it or bring it back; `kit` says it is an SFZ kit's pad, muted through the player rather than the tap.
  | { kind: "mute"; symbol: string; note: number; on: boolean; kit: boolean };

/** The sample's file name without its folders or extension — what fits under a pad. */
const shortName = (ref: string): string =>
  ref.slice(ref.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

export function TapWidget({
  bind,
  sound,
  fixed = false,
  lit,
  style,
  onTrigger,
  onEdit,
  onMenu,
}: {
  bind: string | undefined;
  /** The sound the bind names, off the node — undefined for the "+" tap, or a stale bind. */
  sound: WebRackSound | undefined;
  /** An SFZ KIT's pad: it sounds through its note, and nothing about it is edited here (docs/racks.md). */
  fixed?: boolean;
  lit: boolean;
  style: React.CSSProperties;
  /** Audition it — absent, the pad is drawn and silent, the honest state of a host with no engine. */
  onTrigger?: () => void;
  /** Ask the host to write — absent, the note and the sample are shown and not editable. */
  onEdit?: (action: TapAction) => void;
  /** Right-click: the host's menu for this sound, at the pointer — absent, the browser's own. */
  onMenu?: (x: number, y: number) => void;
}) {
  const [typing, setTyping] = useState(false);
  // Every gesture stops here: a press is not a pan, a click not a selection, a double-click not "back".
  const keep = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  // An add tap: a bare one picks the note itself, an empty cell of the octave grid adds on ITS note.
  const add = rackAddBind(bind);
  if (add) {
    const at = add.note ?? undefined;
    return (
      <button
        type="button"
        className="dgx-w dgx-tap add"
        style={style}
        title={
          at === undefined
            ? "Add a tap — then pick its sample"
            : `Add a tap on note ${at} — then pick its sample`
        }
        aria-label="Add a tap"
        disabled={!onEdit}
        {...keep}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(
            at === undefined ? { kind: "add" } : { kind: "add", note: at },
          );
        }}
      >
        <Plus />
      </button>
    );
  }

  const symbol = rackBindSymbol(bind) ?? "?";
  const sample = sound?.sample;
  // Anything it can SOUND: a library sample, the clip or slice an older kit names, or a kit's note (packages/song/docs/racks.md).
  const playable = !!(
    sample ||
    sound?.clip ||
    sound?.source ||
    (fixed && sound)
  );
  // A kit's pad is the kit's: no write, and no sample of its own to show.
  const edit = fixed ? undefined : onEdit;
  // …but its MUTE is the node's either way, so a kit's pad takes that one write.
  const muted = !!sound?.mute;
  return (
    <div
      className={`dgx-w dgx-tap${muted ? " muted" : ""}`}
      style={style}
      {...keep}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu(e.clientX, e.clientY);
            }
          : undefined
      }
    >
      <button
        type="button"
        className={`dgx-tap-pad${lit ? " on" : ""}`}
        title={
          fixed
            ? `${symbol} — note ${sound?.note ?? "?"}, played by the kit`
            : sample
              ? `${symbol} — ${sample}`
              : playable
                ? symbol
                : `${symbol} — no sample yet`
        }
        disabled={!onTrigger || !playable}
        onClick={(e) => {
          e.stopPropagation();
          onTrigger?.();
        }}
      >
        {symbol}
      </button>
      <div className="dgx-tap-row">
        <button
          type="button"
          className="dgx-tap-note"
          title={
            fixed
              ? "The note the kit plays it on"
              : "The note it answers to — click to type another"
          }
          disabled={!edit || !sound}
          onClick={(e) => {
            e.stopPropagation();
            setTyping(true);
          }}
        >
          {sound?.note ?? "–"}
        </button>
        <button
          type="button"
          className={`dgx-tap-sample${sample || fixed ? "" : " unknown"}`}
          title={
            fixed
              ? "Its sound is the kit's: velocity layers and round-robins"
              : (sample ?? "pick a sample from a library's samples/")
          }
          disabled={!edit}
          onClick={(e) => {
            e.stopPropagation();
            edit?.({ kind: "sample", symbol, x: e.clientX, y: e.clientY });
          }}
        >
          {fixed ? "kit" : sample ? shortName(sample) : "sample…"}
        </button>
      </div>
      {onEdit && sound && (
        <button
          type="button"
          className="dgx-tap-m"
          title={muted ? `Unmute ${symbol}` : `Mute ${symbol}`}
          aria-label={muted ? `Unmute ${symbol}` : `Mute ${symbol}`}
          aria-pressed={muted}
          onClick={(e) => {
            e.stopPropagation();
            onEdit({
              kind: "mute",
              symbol,
              note: sound.note,
              on: !muted,
              kit: fixed,
            });
          }}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
      )}
      {edit && (
        <button
          type="button"
          className="dgx-tap-x"
          title={`Remove ${symbol}`}
          aria-label={`Remove ${symbol}`}
          onClick={(e) => {
            e.stopPropagation();
            edit({ kind: "remove", symbol });
          }}
        >
          <X />
        </button>
      )}
      {typing && (
        <ValueEditor
          initial={sound?.note}
          onDone={(text) => {
            setTyping(false);
            const note = text === null ? Number.NaN : Number(text.trim());
            if (
              Number.isInteger(note) &&
              note >= 0 &&
              note <= 127 &&
              note !== sound?.note
            )
              edit?.({ kind: "note", symbol, note });
          }}
        />
      )}
    </div>
  );
}
