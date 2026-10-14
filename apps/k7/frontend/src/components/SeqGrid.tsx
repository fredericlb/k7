// SeqGrid.tsx — a sequence's notes as a piano roll or a tracker, mounted imperatively from
// @studio/ui-editor. CONTROLLED: it never reads or writes a file, it takes the content and
// hands back the whole next content, so the two hosts can persist it their own way — the
// popin's tabs into the editor's buffer, the main view straight to disk.

import {
  mountSeqGrid,
  type SeqGridController,
} from "@studio/ui-editor/tracker/plugin";
import { useEffect, useRef } from "react";
import type { SeqView } from "../sequenceEdit";
import type { Hints } from "../types";

export function SeqGrid({
  view,
  content,
  racks,
  // What the grid is OF: a change to it rebuilds rather than updates, another file's notes not being this one's edited.
  resetKey,
  onChange,
}: {
  view: SeqView;
  content: string;
  racks: Hints["racks"];
  resetKey: string;
  onChange: (nextContent: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<SeqGridController | null>(null);
  // Both read through refs so the mount effect below takes neither as a dependency.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contentRef = useRef(content);
  contentRef.current = content;

  // NOT keyed on `content`: re-mounting on every edit would drop the tracker's cursor, and `resetKey` IS the remount key.

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the remount key, by design.
  useEffect(() => {
    if (!host.current) return;
    const c = mountSeqGrid(host.current, {
      view,
      content: contentRef.current,
      racks,
      onChange: (next) => onChangeRef.current(next),
    });
    ctrl.current = c;
    return () => {
      c.destroy();
      ctrl.current = null;
    };
  }, [view, racks, resetKey]);

  useEffect(() => {
    ctrl.current?.update(content);
  }, [content]);

  return <div ref={host} className="h-full w-full" />;
}
