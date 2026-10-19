// useProjectTasks.ts — the OPEN project's tasks, read off the workspace's TODOS.md and read again
// whenever the workspace's revision moves, for the timeline's ruler to draw at their timecode.
// A task pinned to another song is not this one's, so only an anchor naming `project` is kept.
// See apps/k7/frontend/docs/tasks.md.

import { parseTasks, TASKS_FILE, type Task } from "@studio/song-schema/tasks";
import { useEffect, useState } from "react";
import { api } from "../api";
import { keepIfSame } from "../shellEquality";
import { useRevision } from "./useRevision";

/** The tasks pinned to `project`, as the workspace names it; none while no project is open. */
export function useProjectTasks(project: string | null): Task[] {
  const revision = useRevision();
  const [tasks, setTasks] = useState<Task[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the trigger, not an input.
  useEffect(() => {
    if (!project) {
      setTasks(keepIfSame<Task[]>([]));
      return;
    }
    let live = true;
    void api
      .read(TASKS_FILE)
      .then((f) => {
        if (live)
          setTasks(
            keepIfSame(
              parseTasks(f.content).filter((t) => t.at?.project === project),
            ),
          );
      })
      // No TODOS.md yet is no task, not an error worth a word here: the panel says the rest.
      .catch(() => live && setTasks(keepIfSame<Task[]>([])));
    return () => {
      live = false;
    };
  }, [project, revision]);
  return tasks;
}
