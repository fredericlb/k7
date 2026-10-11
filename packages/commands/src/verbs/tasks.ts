// tasks.ts — the workspace's task list, `TODOS.md` at the repository root: `task add` and `task mark`
// append one (the second pinned to the open project at a position), `task done` ticks one, `task remove`
// drops one. A task is addressed by its NUMBER in the list, as the panel shows it. The file's format and
// its edits are song-schema's `tasks.ts`; this only reads, writes and refuses. See docs/verbs.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  addTask,
  removeTask,
  setTaskDone,
  TASKS_FILE,
} from "@studio/song-schema/tasks";
import { parsePosition } from "@studio/song-schema/timecode";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const TASK_VERBS: Record<string, SidHandler> = {
  "task.add": (a, h) => add(a, h, false),
  "task.mark": (a, h) => add(a, h, true),
  "task.done": (a, h) => edit(a, h, "done"),
  "task.remove": (a, h) => edit(a, h, "remove"),
};

/** The file, or a refusal: tasks belong to a workspace and never fall back to the song's folder. */
function tasksFile(h: CommandHost): string | null {
  if (!h.repoDir) {
    h.refuse([`no workspace here — the tasks live in its ${TASKS_FILE}`]);
    return null;
  }
  return resolve(h.repoDir, TASKS_FILE);
}

const read = (abs: string): string =>
  existsSync(abs) ? readFileSync(abs, "utf8") : "";

async function add(a: string, h: CommandHost, mark: boolean): Promise<void> {
  const abs = tasksFile(h);
  if (!abs) return;
  const words = splitWords(a);
  const timecode = mark ? words.shift() : undefined;
  const text = words.join(" ");
  if (!text) {
    h.refuse([
      mark
        ? "usage: task mark <timecode> <text>  (e.g. task mark 49:1 fix the snare)"
        : "usage: task add <text>  (e.g. task add bounce the bass)",
    ]);
    return;
  }
  let at: { project: string; timecode: string } | undefined;
  if (timecode !== undefined) {
    const p = h.project();
    try {
      parsePosition(timecode, p.timeSigNumerator, p.timeSigDenominator);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // The project as the workspace names it, so the anchor still reads in a file shared by several.
    const project = relative(h.repoDir as string, h.songPath)
      .split("\\")
      .join("/");
    at = { project: project || ".", timecode };
  }
  writeFileSync(
    abs,
    addTask(read(abs), { text, ...(at ? { at } : {}) }),
    "utf8",
  );
  h.log([`task added${at ? ` at ${at.project} ${at.timecode}` : ""}: ${text}`]);
}

async function edit(
  a: string,
  h: CommandHost,
  op: "done" | "remove",
): Promise<void> {
  const abs = tasksFile(h);
  if (!abs) return;
  const n = Number(splitWords(a)[0]);
  if (!Number.isInteger(n) || n < 1) {
    h.refuse([
      `usage: task ${op} <number>  (the task's place in the list, from 1)`,
    ]);
    return;
  }
  const before = read(abs);
  const after = op === "done" ? setTaskDone(before, n) : removeTask(before, n);
  if (after === null) {
    h.refuse([`no task ${n} in ${TASKS_FILE}`]);
    return;
  }
  writeFileSync(abs, after, "utf8");
  h.log([op === "done" ? `task ${n} ticked or unticked` : `task ${n} removed`]);
}
