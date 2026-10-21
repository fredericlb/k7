// useTimelineDrop.ts — files dragged off the desktop onto the timeline: the bytes into `clips/`,
// one `clips/<id>.k7x` declaring each, then `event add` / `picture add` to put them where the
// pointer was. The PLAN is timelineDrop.ts's; this is the three round trips it takes, in the one
// order that works — nothing is placed before everything it names is on disk. See
// ../../docs/timeline.md.

import { IMAGE_SOURCE } from "@studio/song-schema/yaml/entitySchemas";
import { MAX_UPLOAD_BYTES } from "@studio/web-protocol";
import { useCallback, useState } from "react";
import { fileClip } from "../clipFiles";
import {
  isPortrait,
  type MediaInfo,
  mediaInfo,
  mediaInfoAt,
} from "../mediaSeconds";
import { m } from "../paraglide/messages.js";
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
  /** The picture as it stands — landscape or not, and whether it still holds only the scaffold's sample; null with no picture. */
  pictureShape?: () => { landscape: boolean; untouched: boolean } | null,
): {
  onDrop: (d: TimelineDropEvent) => Promise<void>;
  onDropResource: (d: ResourceDropEvent) => Promise<void>;
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
            ? m["status.drop.refused"]({ files: plan.refused.join(", ") })
            : m["status.drop.nothing"](),
        );
        return;
      }
      // planDrop keeps the drop's order and skips exactly what `droppedKind` refuses, so these pair up by index.
      const carried = files.filter((f) => droppedKind(f.name));

      // 1. a file over the upload limit is refused by NAME before anything is sent — a 4K clip would climb to 100% and then fail.
      const tooBig = carried.filter((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooBig.length) {
        setStatus(
          m["status.drop.tooBig"]({
            files: tooBig.map((f) => f.name).join(", "),
            mb: String(MAX_UPLOAD_BYTES / (1024 * 1024)),
          }),
          "error",
        );
        return;
      }
      // The FILES go as they are: the browser streams each from disk, where reading them first held whole videos in the tab.
      const entries = carried.map((f) => ({ bytes: f as Blob, size: f.size }));
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
      // The id each clip was FILED under — another one when its name was taken by a different file.
      const filedAs = new Map<string, string>();
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
          filedAs.set(c.id, filed.id);
          if (filed.reused) reused.push(filed.id);
        } catch (e) {
          setUpload(null);
          setStatus(
            m["status.drop.fileFailed"]({
              name: c.upload,
              message: (e as Error).message,
            }),
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
      // A still has no length of its own, so it is placed with one: five seconds, trimmed like any shot.
      const infos = new Map<string, MediaInfo | null>();
      await Promise.all(
        plan.declare.map(async (c, i) => {
          if (c.kind !== "video") return;
          infos.set(
            c.id,
            IMAGE_SOURCE.test(c.upload)
              ? { seconds: STILL_SECONDS, width: 0, height: 0 }
              : await mediaInfo(carried[i]),
          );
        }),
      );
      // A phone clip into a picture nobody has touched yet: the PROJECT turns to 9:16 rather than cropping the clip.
      const first = plan.place.find((p) => kindOf.get(p.id) === "video");
      const firstInfo = first ? infos.get(first.id) : null;
      const shape = pictureShape?.();
      if (
        firstInfo &&
        isPortrait(firstInfo) &&
        shape?.landscape &&
        shape.untouched
      ) {
        await runCommand("project aspect 9:16");
        setStatus(m["status.drop.portrait"]());
      }
      // Videos dropped together play one AFTER another on the drop lane, each where the previous one ends.
      let at = seconds;
      for (const p of plan.place) {
        const ref = filedAs.get(p.id) ?? p.id;
        if (kindOf.get(p.id) !== "video") {
          await runCommand(`event add ${p.lane} ${ref} ${tc}`);
          continue;
        }
        // Placed with its measured length, since a shot with none counts for nothing in an export's duration.
        const length = infos.get(p.id)?.seconds ?? null;
        await runCommand(
          `picture add ${p.lane} ${ref} ${Math.round(at * 1000) / 1000}${length ? ` ${length}` : ""}`,
        );
        // A length the browser could not read: the next one starts a still's worth later rather than on top.
        at += length ?? STILL_SECONDS;
      }
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
    [project, runCommand, setStatus, bumpReload, pictureShape],
  );

  // A resource from the resources panel: its clip is already declared, so only the PLACING half runs.
  const onDropResource = useCallback(
    async ({ lane, kind, id, url, tc, seconds }: ResourceDropEvent) => {
      if (kind === "audio") {
        await runCommand(`event add ${lane} ${id} ${tc}`);
        return;
      }
      // Its measured length, as a dropped file's: a shot with none counts for nothing in an export's duration.
      const length = (await mediaInfoAt(url))?.seconds ?? null;
      await runCommand(
        `picture add ${lane} ${id} ${Math.round(seconds * 1000) / 1000}${length ? ` ${length}` : ""}`,
      );
      await runCommand(`picture sound ${lane}`);
      await runCommand(`picture prepare ${lane}`);
    },
    [runCommand],
  );

  return { onDrop, onDropResource, upload };
}

/** A resource dropped on a lane of its kind: the clip, where to probe it, and where the pointer was. */
export interface ResourceDropEvent {
  lane: string;
  kind: "audio" | "video";
  id: string;
  url: string;
  tc: string;
  seconds: number;
}
