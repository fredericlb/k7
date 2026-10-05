// SeqGridPane.tsx — a sequence's piano roll or tracker where the chains graph normally is,
// opened by `sequence edit roll|tracker <sequence>` and closed by the × back to the graph.
// The frame and its bar; the file behind it is `SeqGridFile`, which the clip pane mounts too.
// See docs/noteGrids.md.

import { Grid3x3, Piano } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { api } from "../api";
import { fileStem } from "../projectPaths";
import type { SeqView } from "../sequenceEdit";
import type { Hints } from "../types";
import { GraphSlotPane } from "./GraphSlotPane";
import { SeqGridFile } from "./SeqGridFile";

export function SeqGridPane({
  path,
  view,
  onChanged,
  setStatus,
}: {
  path: string;
  view: SeqView;
  // A write landed: the polls need to pick the notes up (the timeline draws them too).
  onChanged: () => void;
  setStatus: (s: string) => void;
}) {
  const [racks, setRacks] = useState<Hints["racks"]>({});

  useEffect(() => {
    let done = false;
    api.hints().then((h) => !done && setRacks(h.racks));
    return () => {
      done = true;
    };
  }, []);

  const Icon = view === "tracker" ? Grid3x3 : Piano;
  return (
    <GraphSlotPane
      // Its own strip: a glyph for the grid's kind, the stem, and the path in full .
      bar={
        <>
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{fileStem(path)}</span>
          <span>{view === "tracker" ? "tracker" : "piano roll"}</span>
          <span className="truncate">{path}</span>
        </>
      }
    >
      <div className="h-full min-h-0 overflow-auto">
        <SeqGridFile
          path={path}
          view={view}
          racks={racks}
          onChanged={onChanged}
          setStatus={setStatus}
        />
      </div>
    </GraphSlotPane>
  );
}
