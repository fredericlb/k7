// TasksPanel.tsx — the workspace's task list, `TODOS.md` at its root, as a panel on the right: a line to
// type a task into, a box that pins it to where the playhead is in this song, and the list with a tick
// and a bin per task. It writes nothing itself — every change is a `task …` command, then a re-read,
// since the FILE is the truth and a person may edit it by hand (../docs/tasks.md). Above the list, the
// open project's TAGS, written the same way through `project tag` / `project untag`.

import { Button } from "@frediverse/ui/button";
import { ListChecks, Plus, Trash2, X } from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { projectTagsOf } from "@studio/song-schema/projectTags";
import { parseTasks, TASKS_FILE, type Task } from "@studio/song-schema/tasks";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useRevision } from "../hooks/useRevision";
import { m } from "../paraglide/messages.js";

export function TasksPanel({
  project,
  timecode,
  onSeek,
  onRun,
  onClose,
}: {
  /** The open project as the workspace names it — a task pinned there can be jumped to. */
  project: string | null;
  /** Where the playhead is now, as a timecode — read when a task is added, never subscribed to. */
  timecode: () => string;
  /** Put the playhead on a timecode of the open project. */
  onSeek: (timecode: string) => void;
  onRun: (line: string) => Promise<void>;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const revision = useRevision();

  const refreshTags = useCallback(async () => {
    if (!project) return setTags([]);
    try {
      const file = project === "." ? "project.yaml" : `${project}/project.yaml`;
      setTags(projectTagsOf((await api.read(file)).content));
    } catch {
      setTags([]);
    }
  }, [project]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the trigger, not an input.
  useEffect(() => {
    void refreshTags();
  }, [refreshTags, revision]);
  const runTag = async (line: string) => {
    await onRun(line);
    await refreshTags();
  };

  const refresh = useCallback(async () => {
    try {
      setTasks(parseTasks((await api.read(TASKS_FILE)).content));
      setError("");
    } catch (e) {
      // No file yet is an empty list, not an error: the first task creates it.
      if ((e as { status?: number }).status === 404) setTasks([]);
      else setError((e as Error).message);
    }
  }, []);
  // On open, and whenever the workspace's revision moves — the file may have changed under the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the trigger, not an input.
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const run = async (line: string) => {
    await onRun(line);
    await refresh();
  };
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await run(
      attach && project ? `task mark ${timecode()} ${t}` : `task add ${t}`,
    );
  };
  // A removed task is gone from the file, so the bin asks first and names what it drops.
  const removeTask = async (n: number, task: string) => {
    const ok = await askConfirm({
      title: m["tasks.removeTitle"](),
      body: task,
      confirmLabel: m["common.remove"](),
      cancelLabel: m["common.cancel"](),
      danger: true,
    });
    if (ok) await run(`task remove ${n}`);
  };

  return (
    <aside className="flex w-[24rem] min-w-0 shrink-0 flex-col border-border border-l bg-background">
      <header className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
        <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm">
          {m["tasks.title"]()}
        </span>
        <span className="shrink-0 px-1 font-mono text-[10px] text-muted-foreground">
          {TASKS_FILE}
        </span>
        <Button
          size="icon"
          variant="ghost"
          title={m["common.close"]()}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {project && (
        <form
          className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = tag.trim();
            if (!t) return;
            setTag("");
            void runTag(`project tag ${t}`);
          }}
        >
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-0.5 rounded bg-secondary py-0.5 pr-0.5 pl-1.5 text-muted-foreground text-xs"
            >
              {t}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                onClick={() => void runTag(`project untag ${t}`)}
                title={m["tasks.untag"]({ tag: t })}
                aria-label={m["tasks.untag"]({ tag: t })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={m["tasks.tagPlaceholder"]()}
            title={m["tasks.tagHint"]()}
            className="min-w-[6rem] flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-primary"
          />
        </form>
      )}

      <form
        className="flex flex-col gap-1.5 border-b border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={m["tasks.placeholder"]()}
            className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-primary"
          />
          <Button
            type="submit"
            size="icon"
            className="h-8 w-8"
            disabled={!text.trim()}
            title={m["tasks.add"]()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <label
          className={`flex items-center gap-1.5 text-xs ${project ? "" : "opacity-50"}`}
          title={project ? m["tasks.attachHint"]() : m["tasks.attachNone"]()}
        >
          <input
            type="checkbox"
            checked={attach}
            disabled={!project}
            onChange={(e) => setAttach(e.target.checked)}
          />
          {m["tasks.attach"]()}
        </label>
      </form>

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {error && <p className="px-2 py-1 text-xs text-red-500">{error}</p>}
        {tasks?.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {m["tasks.empty"]()}
          </p>
        )}
        {tasks?.map((t, i) => {
          const n = i + 1;
          // A pin into THIS song jumps the playhead; one into another song only says where.
          const here = !!t.at && t.at.project === project;
          return (
            <div
              key={`${t.line}:${t.text}`}
              className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={t.done}
                onChange={() => void run(`task done ${n}`)}
                aria-label={t.done ? m["tasks.untick"]() : m["tasks.tick"]()}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`break-words text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}
                >
                  {t.text}
                </div>
                {t.at && (
                  <button
                    type="button"
                    disabled={!here}
                    onClick={() => t.at && onSeek(t.at.timecode)}
                    className="font-mono text-[10px] text-muted-foreground enabled:cursor-pointer enabled:text-primary enabled:hover:underline"
                    title={
                      here
                        ? m["tasks.seek"]()
                        : m["tasks.elsewhere"]({ project: t.at.project })
                    }
                  >
                    {here
                      ? t.at.timecode
                      : `${t.at.project} @ ${t.at.timecode}`}
                  </button>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => void removeTask(n, t.text)}
                title={m["tasks.remove"]()}
                aria-label={m["tasks.remove"]()}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
