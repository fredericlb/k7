// MomentRow.tsx — one saved moment of a session's page: its span, which plays in the session, its
// name and tags edited in place, its range adjusted by handles and nudges, and its own clip once cut.

import { Button } from "@frediverse/ui/button";
import { Check, MoveHorizontal, Trash2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { MomentPlayer, TagInput } from "@studio/recorder";
import { useEffect, useMemo, useState } from "react";
import { confirmLoss } from "../confirm";
import { fmtTime } from "../format";
import { m } from "../paraglide/messages.js";
import type { Annotation, Envelope, Selection } from "../types";

interface MomentRowProps {
  ann: Annotation;
  envelope: Envelope | null;
  duration: number;
  allTags: string[];
  validating: string | null;
  momentClipUrl: (annId: string) => string;
  // Non-null while this moment's time range is being adjusted (live draft).
  editRange: Selection | null;
  onPlay: (start: number, end: number) => void;
  onUpdate: (
    annId: string,
    patch: {
      text?: string;
      tags?: string[];
      startSec?: number;
      endSec?: number;
    },
  ) => Promise<void>;
  onValidate: (annId: string) => Promise<void>;
  onDelete: (annId: string) => Promise<void>;
  onBeginEdit: () => void;
  onEditRange: (range: Selection) => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
}

export function MomentRow({
  ann,
  envelope,
  duration,
  allTags,
  validating,
  momentClipUrl,
  editRange,
  onPlay,
  onUpdate,
  onValidate,
  onDelete,
  onBeginEdit,
  onEditRange,
  onApplyEdit,
  onCancelEdit,
}: MomentRowProps) {
  // Local draft for the name so typing stays snappy; persisted on blur/Enter.
  const [name, setName] = useState(ann.text);
  useEffect(() => setName(ann.text), [ann.text]);

  const saveName = () => {
    const t = name.trim();
    if (t !== ann.text) onUpdate(ann.id, { text: t });
  };

  // The session envelope sliced to this span, so the clip player needs no envelope of its own.
  const clipSamples = useMemo(() => {
    if (!envelope) return [];
    const per = envelope.intervalMs / 1000;
    const i0 = Math.max(0, Math.floor(ann.startSec / per));
    const i1 = Math.min(envelope.samples.length, Math.ceil(ann.endSec / per));
    return envelope.samples.slice(i0, i1);
  }, [envelope, ann.startSec, ann.endSec]);

  const isEditing = editRange != null;
  // While editing, show the live draft range; otherwise the committed one.
  const shownStart = editRange ? editRange.start : ann.startSec;
  const shownEnd = editRange ? editRange.end : ann.endSec;

  const nudgeStart = (d: number) => {
    if (!editRange) return;
    const start = Math.max(
      0,
      Math.min(editRange.start + d, editRange.end - 0.1),
    );
    onEditRange({ start, end: editRange.end });
  };
  const nudgeEnd = (d: number) => {
    if (!editRange) return;
    const end = Math.min(
      duration,
      Math.max(editRange.end + d, editRange.start + 0.1),
    );
    onEditRange({ start: editRange.start, end });
  };

  return (
    <li
      className={`annotation-item${ann.validated ? " validated" : ""}${
        isEditing ? " editing" : ""
      }`}
    >
      <Button
        variant="link"
        onClick={() => onPlay(shownStart, shownEnd)}
        title={m["moment.playInSession"]()}
      >
        {ann.validated && <Check className="size-3.5" />}
        {fmtTime(shownStart)} – {fmtTime(shownEnd)}
      </Button>
      {!ann.validated && (
        <Button
          variant="outline"
          size="sm"
          disabled={validating === ann.id}
          onClick={() => onValidate(ann.id)}
          title={m["moment.validateTitle"]()}
        >
          {validating === ann.id ? (
            m["moment.extracting"]()
          ) : (
            <>
              <Check className="size-4" /> {m["moment.validate"]()}
            </>
          )}
        </Button>
      )}
      {!isEditing && (
        <Button
          variant="outline"
          size="sm"
          onClick={onBeginEdit}
          title={m["moment.adjustTitle"]()}
        >
          <MoveHorizontal className="size-4" /> {m["moment.adjust"]()}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        aria-label={m["moment.delete"]()}
        title={m["moment.delete"]()}
        onClick={async () => {
          if (await confirmLoss(m["moment.confirmDelete"]())) onDelete(ann.id);
        }}
      >
        <Trash2 className="size-4" />
      </Button>

      {isEditing && (
        <div className="moment-range-edit">
          <p className="muted small">{m["moment.nudgeHelp"]()}</p>
          <div className="row range-nudge">
            <span className="muted small">{m["moment.start"]()}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nudgeStart(-0.5)}
            >
              −0.5s
            </Button>
            <Button variant="outline" size="sm" onClick={() => nudgeStart(0.5)}>
              +0.5s
            </Button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              {m["moment.end"]()}
            </span>
            <Button variant="outline" size="sm" onClick={() => nudgeEnd(-0.5)}>
              −0.5s
            </Button>
            <Button variant="outline" size="sm" onClick={() => nudgeEnd(0.5)}>
              +0.5s
            </Button>
          </div>
          <div className="row">
            <Button size="sm" onClick={onApplyEdit}>
              <Check className="size-4" /> {m["moment.apply"]()}
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelEdit}>
              {m["common.cancel"]()}
            </Button>
          </div>
        </div>
      )}

      <div className="row moment-edit">
        <Input
          value={name}
          placeholder={m["moment.name"]()}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <TagInput
          value={ann.tags}
          onChange={(tags) => onUpdate(ann.id, { tags })}
          suggestions={allTags}
          removeLabel={(tag) => m["recorder.removeTag"]({ tag })}
        />
      </div>
      {ann.validated && (
        <MomentPlayer
          src={momentClipUrl(ann.id)}
          samples={clipSamples}
          intervalMs={envelope?.intervalMs ?? 200}
          labels={{ play: m["common.play"](), pause: m["common.pause"]() }}
        />
      )}
    </li>
  );
}
