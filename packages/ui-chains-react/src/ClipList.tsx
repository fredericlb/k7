// ClipList.tsx — the clips a lane card lists under its header — docs/nodeCard.md.

import { CLIP_LIST_MAX, type GraphNode } from "@studio/ui-chains/graph";
import { useState } from "react";

/** A lane's events: a mini timeline of the whole lane, then the first few by name — docs/nodeCard.md. */
export function ClipList({
  clips,
  more,
  color,
}: {
  clips: NonNullable<GraphNode["clips"]>;
  more?: number;
  /** The TRACK's own colour — what its clips are drawn in. Absent when the lane authors none. */
  color?: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const shown = clips.slice(0, CLIP_LIST_MAX);
  return (
    <div className="dgx-clips">
      {/* The lane at a glance: one block per clip, coloured by the TRACK; see docs/nodeCard.md. */}
      <div className="dgx-clip-tl">
        {clips.map((c, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the identity here — it
            // pairs a block with its row below, and two clips may share a ref and a position.
            key={i}
            className={`dgx-clip-mk${c.kind === "missing" ? " missing" : ""}${
              hot === i ? " hot" : ""
            }`}
            style={{
              left: `${c.at * 100}%`,
              width: `${c.w * 100}%`,
              ...(c.kind !== "missing" && color ? { background: color } : {}),
            }}
            title={`${c.tc} — ${c.ref}`}
            onPointerEnter={() => setHot(i)}
            onPointerLeave={() => setHot(null)}
          />
        ))}
      </div>
      {shown.map((c, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: pairs with the marker above, as there.
          key={i}
          className={`dgx-clip${c.kind === "missing" ? " missing" : ""}${
            hot === i ? " hot" : ""
          }`}
          title={
            c.kind === "missing"
              ? `${c.tc} — ${c.ref}: no such clip in this project`
              : `${c.tc} — ${c.ref} (${c.kind})`
          }
        >
          {/* WHERE first, then WHAT: a fixed-width column of positions stays a column, with tabular figures. */}
          <span className="dgx-clip-tc">{c.tc}</span>
          <span className="dgx-clip-nm">{c.ref}</span>
        </div>
      ))}
      {more ? <div className="dgx-clip more">+{more}</div> : null}
    </div>
  );
}
