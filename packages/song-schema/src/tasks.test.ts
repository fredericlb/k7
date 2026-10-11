// TODOS.md as a checklist the app and a person both edit: tasks read with their anchors, and every
// edit touching its own line only — the prose around them survives.

import { describe, expect, it } from "vitest";
import {
  addTask,
  parseTasks,
  removeTask,
  setTaskDone,
  taskLine,
} from "./tasks";

const FILE = `# Tasks

Notes for the band.

- [ ] fix the snare \`05.paradoxe.st0 @ 49:1\`
- [x] bounce the bass
* [ ] call Lou
`;

describe("parseTasks", () => {
  it("reads every checklist line, its state and its anchor, and nothing else", () => {
    expect(parseTasks(FILE)).toEqual([
      {
        line: 4,
        text: "fix the snare",
        done: false,
        at: { project: "05.paradoxe.st0", timecode: "49:1" },
      },
      { line: 5, text: "bounce the bass", done: true },
      { line: 6, text: "call Lou", done: false },
    ]);
  });

  it("round-trips a line through taskLine", () => {
    const [t] = parseTasks(FILE);
    expect(taskLine(t)).toBe("- [ ] fix the snare `05.paradoxe.st0 @ 49:1`");
  });
});

describe("the edits", () => {
  it("appends a task, and starts a new file with a heading", () => {
    expect(addTask(FILE, { text: "tune the toms" })).toBe(
      `${FILE}- [ ] tune the toms\n`,
    );
    expect(
      addTask("", { text: "first", at: { project: "a.st0", timecode: "2:1" } }),
    ).toBe("# Tasks\n\n- [ ] first `a.st0 @ 2:1`\n");
  });

  it("ticks, unticks and removes by position, leaving every other line alone", () => {
    const ticked = setTaskDone(FILE, 1) as string;
    expect(ticked).toContain("- [x] fix the snare `05.paradoxe.st0 @ 49:1`");
    expect(ticked).toContain("Notes for the band.");
    expect(setTaskDone(FILE, 2)).toContain("- [ ] bounce the bass");
    const removed = removeTask(FILE, 2) as string;
    expect(parseTasks(removed).map((t) => t.text)).toEqual([
      "fix the snare",
      "call Lou",
    ]);
    expect(removed).toContain("Notes for the band.");
  });

  it("answers null for a task that is not there", () => {
    expect(setTaskDone(FILE, 9)).toBeNull();
    expect(removeTask(FILE, 0)).toBeNull();
  });
});
