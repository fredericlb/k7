// TapWidget.tsx — one sound of a rack, on its node's card: a pad that auditions it and lights when
// its note plays, the NOTE it answers to, and the library SAMPLE it fires. The last tap of a grid adds
// a sound instead. Every edit is only ASKED of the host, which writes the node's file; the card holds
// nothing of its own. See packages/song/docs/racks.md.

import { Plus, X } from "@frediverse/ui/icons";
import type { WebRackSound } from "@studio/graph-model";
import { RACK_ADD_BIND, rackBindSymbol } from "@studio/ui-chains/graph";
import { useState } from "react";
import { ValueEditor } from "./ValueEditor";

/** What a tap asks of its host: the three writes, and the sample picker, which is the host's popup. */
export type TapAction =
  | { kind: "note"; symbol: string; note: number }
  | { kind: "sample"; symbol: string; x: number; y: number }
  | { kind: "add" }
  | { kind: "remove"; symbol: string };

/** The sample's file name without its folders or extension — what fits under a pad. */
const shortName = (ref: string): string =>
  ref.slice(ref.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

export function TapWidget({
  bind,
  sound,
  lit,
  style,
  onTrigger,
  onEdit,
  onMenu,
}: {
  bind: string | undefined;
  /** The sound the bind names, off the node — undefined for the "+" tap, or a stale bind. */
  sound: WebRackSound | undefined;
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

  if (bind === RACK_ADD_BIND)
    return (
      <button
        type="button"
        className="dgx-w dgx-tap add"
        style={style}
        title="Add a tap — then pick its sample"
        aria-label="Add a tap"
        disabled={!onEdit}
        {...keep}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.({ kind: "add" });
        }}
      >
        <Plus />
      </button>
    );

  const symbol = rackBindSymbol(bind) ?? "?";
  const sample = sound?.sample;
  // Anything it can SOUND: a library sample, or the clip or slice an older kit names (packages/song/docs/racks.md).
  const playable = !!(sample || sound?.clip || sound?.source);
  return (
    <div
      className="dgx-w dgx-tap"
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
          sample
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
          title="The note it answers to — click to type another"
          disabled={!onEdit || !sound}
          onClick={(e) => {
            e.stopPropagation();
            setTyping(true);
          }}
        >
          {sound?.note ?? "–"}
        </button>
        <button
          type="button"
          className={`dgx-tap-sample${sample ? "" : " unknown"}`}
          title={sample ?? "pick a sample from a library's samples/"}
          disabled={!onEdit}
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.({ kind: "sample", symbol, x: e.clientX, y: e.clientY });
          }}
        >
          {sample ? shortName(sample) : "sample…"}
        </button>
      </div>
      {onEdit && (
        <button
          type="button"
          className="dgx-tap-x"
          title={`Remove ${symbol}`}
          aria-label={`Remove ${symbol}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit({ kind: "remove", symbol });
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
              onEdit?.({ kind: "note", symbol, note });
          }}
        />
      )}
    </div>
  );
}
