// MarkerRow.tsx — one pin of a session's or a moment's timeline: its time, which seeks there, its
// comment, saved on blur, and its delete. Without the two handlers it is read, not edited.

import { Button } from "@frediverse/ui/button";
import { Flag, Trash2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { useEffect, useState } from "react";
import { confirmLoss } from "../confirm";
import { fmtTime } from "../format";
import { m } from "../paraglide/messages.js";
import type { Marker } from "../types";

interface Props {
  marker: Marker;
  onSeek: (sec: number) => void;
  /** Both absent on a shared moment: the marker is read, not edited. */
  onUpdate?: (markerId: string, comment: string) => Promise<void>;
  onDelete?: (markerId: string) => Promise<void>;
}

export function MarkerRow({ marker, onSeek, onUpdate, onDelete }: Props) {
  // Local draft so typing stays snappy; persisted on blur/Enter.
  const [comment, setComment] = useState(marker.comment);
  useEffect(() => setComment(marker.comment), [marker.comment]);

  const saveComment = () => {
    const c = comment.trim();
    if (c !== marker.comment) onUpdate?.(marker.id, c);
  };

  return (
    <li className="marker-item">
      <Button
        variant="link"
        onClick={() => onSeek(marker.atSec)}
        title={m["marker.jump"]()}
      >
        <Flag className="size-4" /> {fmtTime(marker.atSec)}
      </Button>
      {onUpdate ? (
        <Input
          value={comment}
          placeholder={m["marker.comment"]()}
          onChange={(e) => setComment(e.target.value)}
          onBlur={saveComment}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      ) : (
        <span className="marker-comment">{marker.comment}</span>
      )}
      {onDelete && (
        <Button
          variant="outline"
          size="sm"
          aria-label={m["marker.delete"]()}
          title={m["marker.delete"]()}
          onClick={async () => {
            // A bare marker is one tap to put back; its comment is not.
            if (
              !marker.comment ||
              (await confirmLoss(m["marker.confirmDelete"]()))
            )
              onDelete(marker.id);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  );
}
