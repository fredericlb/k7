// tasks.ts — the workspace's TODOS.md, a Markdown checklist a person can also edit by hand: a task is a
// `- [ ] text` line, done when `[x]`, and may end with `` `<project> @ <timecode>` `` — where in which
// song it is about. Every edit rewrites ONE line and leaves every other line as it was, so prose,
// headings and blank lines written around the tasks survive the app. No `node:`: the browser reads it too.

/** Where the tasks live: one file at the workspace root, beside the projects it talks about. */
export const TASKS_FILE = "TODOS.md";

/** One task as read: its line in the file, so an edit can find it again. */
export interface Task {
  line: number;
  text: string;
  done: boolean;
  /** The project folder and the position the task is about, when one was attached. */
  at?: { project: string; timecode: string };
}

const TASK = /^\s*[-*] \[( |x|X)\] (.*)$/;
const ANCHOR = /^(.*?)\s*`([^`@]+?) @ ([^`]+)`\s*$/;

/** Every task line of the file, in order. */
export function parseTasks(text: string): Task[] {
  const out: Task[] = [];
  text.split("\n").forEach((raw, line) => {
    const m = TASK.exec(raw);
    if (!m) return;
    const anchored = ANCHOR.exec(m[2]);
    out.push({
      line,
      done: m[1] !== " ",
      text: (anchored ? anchored[1] : m[2]).trim(),
      ...(anchored
        ? { at: { project: anchored[2].trim(), timecode: anchored[3].trim() } }
        : {}),
    });
  });
  return out;
}

/** A task's line as written. */
export function taskLine(t: Omit<Task, "line">): string {
  const text = t.text.replace(/\s+/g, " ").trim();
  const at = t.at ? ` \`${t.at.project} @ ${t.at.timecode}\`` : "";
  return `- [${t.done ? "x" : " "}] ${text}${at}`;
}

/** The file with a new open task appended — a header first when the file is new. */
export function addTask(
  text: string,
  task: Omit<Task, "line" | "done">,
): string {
  const body = text.trimEnd();
  const line = taskLine({ ...task, done: false });
  return body ? `${body}\n${line}\n` : `# Tasks\n\n${line}\n`;
}

/** The file with task `n` (1-based, in file order) changed by `edit`, or null when there is no such task. */
function editTask(
  text: string,
  n: number,
  edit: (lines: string[], t: Task) => void,
): string | null {
  const t = parseTasks(text)[n - 1];
  if (!t) return null;
  const lines = text.split("\n");
  edit(lines, t);
  return lines.join("\n");
}

/** Task `n` ticked or unticked — `done` absent flips it. */
export function setTaskDone(
  text: string,
  n: number,
  done?: boolean,
): string | null {
  return editTask(text, n, (lines, t) => {
    lines[t.line] = taskLine({ ...t, done: done ?? !t.done });
  });
}

/** Task `n` taken out of the file. */
export function removeTask(text: string, n: number): string | null {
  return editTask(text, n, (lines, t) => {
    lines.splice(t.line, 1);
  });
}
