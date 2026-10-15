// useTimelineDrop.ts — files dragged off the desktop onto the timeline: the bytes into `clips/`,
// one `clips/<id>.yaml` declaring each, then `event add` / `picture add` to put them where the
// pointer was. The PLAN is timelineDrop.ts's; this is the three round trips it takes, in the one
// order that works — nothing is placed before everything it names is on disk. See
// ../../docs/timeline.md.

import { IMAGE_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import { useCallback, useState } from "react";
import { fileClip } from "../clipFiles";
import {
  type DropUpload,
  droppedKind,
  dropReport,
  planDrop,
  type TimelineDropEvent,
} from "../timelineDrop";
import type { SetStatus } from "./useLogs";

/** How long a dropped still is placed for: it has no length of its own to run to. */
const STILL_SECONDS = 5;

export function useTimelineDrop(
  project: string,
  runCommand: (line: string) => Promise<void>,
  setStatus: SetStatus,
  bumpReload: () => void,
): {
  onDrop: (d: TimelineDropEvent) => Promise<void>;
  upload: DropUpload | null;
} {
  const [upload, setUpload] = useState<DropUpload | null>(null);

  const onDrop = useCallback(
    async ({ lane, lanes, tc, seconds, files }: TimelineDropEvent) => {
      const plan = planDrop(
        files.map((f) => f.name),
        lanes,
        lane,
      );
      if (!plan.declare.length) {
        setStatus(
          plan.refused.length
            ? `${plan.refused.join(", ")} — neither audio nor video`
            : "nothing to drop here",
        );
        return;
      }
      // planDrop keeps the drop's order and skips exactly what `droppedKind` refuses, so these pair up by index.
      const carried = files.filter((f) => droppedKind(f.name));

      // 1. the bytes. Read upfront so the bar knows its total, as the file tree's upload does.
      let entries: { bytes: ArrayBuffer; size: number }[];
      try {
        entries = await Promise.all(
          carried.map(async (f) => ({
            bytes: await f.arrayBuffer(),
            size: f.size,
          })),
        );
      } catch (e) {
        setStatus(`drop failed: ${(e as Error).message}`, "error");
        return;
      }
      const total = entries.reduce((s, e) => s + e.size, 0);
      let offset = 0;
      setUpload({
        fileName: plan.declare[0].upload,
        loaded: 0,
        total,
        done: 0,
        count: entries.length,
      });
      // 2. …and the declaration beside each: `fileClip` is the pair, shared with a recorded take.
      const reused: string[] = [];
      for (let i = 0; i < entries.length; i++) {
        const c = plan.declare[i];
        const at = offset;
        try {
          const filed = await fileClip(project, c, entries[i].bytes, (loaded) =>
            setUpload((u) =>
              u
                ? { ...u, loaded: at + loaded, fileName: c.upload, done: i }
                : u,
            ),
          );
          if (filed.reused) reused.push(c.id);
        } catch (e) {
          setUpload(null);
          setStatus(
            `drop failed: ${c.upload} — ${(e as Error).message}`,
            "error",
          );
          return;
        }
        offset += entries[i].size;
      }
      setUpload(null);

      // The tree, the completions and the compile all move; a drop that placed nothing still added files.
      bumpReload();
      // Said BEFORE the placements, which are commands and have the last word — a refusal must not be overwritten.
      setStatus(dropReport(plan, reused));

      // 3. the placements — commands, so each is one journal entry and one Ctrl+Z.
      const kindOf = new Map(plan.declare.map((c) => [c.id, c.kind]));
      const stills = new Set(
        plan.declare
          .filter((c) => IMAGE_SOURCE.test(c.upload))
          .map((c) => c.id),
      );
      for (const p of plan.place)
        await runCommand(
          kindOf.get(p.id) === "video"
            ? // A still has no length of its own, so it is placed with one: five seconds, trimmed like any shot.
              `picture add ${p.lane} ${p.id} ${seconds}${stills.has(p.id) ? ` ${STILL_SECONDS}` : ""}`
            : `event add ${p.lane} ${p.id} ${tc}`,
        );
      // 4. …and a shot's SOUND, which the engine plays from an audio lane (packages/song/docs/videoSound.md).
      const pictured = plan.place
        .filter((p) => kindOf.get(p.id) === "video")
        .map((p) => p.lane);
      for (const lane of new Set(pictured)) {
        await runCommand(`picture sound ${lane}`);
        // …and what a browser cannot play is given a copy it can, in the background (song-video/docs/media.md).
        await runCommand(`picture prepare ${lane}`);
      }
    },
    [project, runCommand, setStatus, bumpReload],
  );

  return { onDrop, upload };
}
