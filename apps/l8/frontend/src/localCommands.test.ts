// The shell's dispatch table against the shell's catalogue. The claim is the one that makes
// the palette worth having: every action on screen is a command, and every command the palette
// lists is one the dispatcher will actually recognise.

import { describe, expect, it } from "vitest";
import { BARE_NAMES, isUiLine, UI_EXACT, UI_HEADS } from "./localCommands";
import { LOCAL_ARGS, LOCAL_COMMANDS } from "./palette";

// What `runLocalCommand` sees: the line lowercased, with any `ui ` prefix already stripped.
const asDispatched = (name: string) =>
  name.replace(/^ui\s+/i, "").toLowerCase();

// A runnable line for a command: its name plus a placeholder for each argument it declares,
// which is what makes a HEAD match rather than an exact one.
const withArgs = (name: string) =>
  [name, ...(LOCAL_ARGS[name] ?? []).map((_, i) => `arg${i}`)].join(" ");

describe("every shell command is one the dispatcher recognises", () => {
  it("classifies each of them on the side of its own prefix", () => {
    // The pairing rule (docs/shell.md): a `ui` name must read as `ui`, a bare one must not.
    // Get it wrong and the command lists in the palette, runs, and is answered with "type: ui …".
    const wrong = LOCAL_COMMANDS.filter((name) => {
      const line = asDispatched(withArgs(name));
      return isUiLine(line) !== /^ui\s/i.test(name);
    });
    expect(wrong, "commands the ui/bare gate would refuse").toEqual([]);
  });

  it("classifies them the same with no arguments typed yet", () => {
    // The bar dispatches the bare name for a command with no args, and the palette also holds
    // one while its form is still being filled — both must land on the same side.
    const wrong = LOCAL_COMMANDS.filter(
      (name) =>
        (LOCAL_ARGS[name] ?? []).length === 0 &&
        isUiLine(asDispatched(name)) !== /^ui\s/i.test(name),
    );
    expect(wrong).toEqual([]);
  });

  it("lets a file VERB through where `ui file` would have caught it", () => {
    // The one real collision: only the second token tells the two apart.
    expect(isUiLine("file kick.yaml")).toBe(true); // `ui file` — open it
    expect(isUiLine("file new clips kick.yaml")).toBe(false); // the tree's verb
    expect(isUiLine("file rename a b")).toBe(false);
    expect(isUiLine("file delete a")).toBe(false);
    expect(isUiLine("folder new clips takes")).toBe(false);
  });

  it("catches a bare verb too, so it reaches its own usage line", () => {
    // Without the whole-word rule `file new` (no arguments yet) fell back onto the `file `
    // head and was answered with "type: ui file new" — advice for a command that is not one.
    for (const n of BARE_NAMES) expect(isUiLine(n), n).toBe(false);
    // …and a name that merely STARTS with one is not it.
    expect(isUiLine("file newsletter.yaml")).toBe(true);
  });

  it("names nothing twice", () => {
    // An exact that is also the head of another would make which one wins an accident of order.
    for (const head of UI_HEADS)
      expect(
        UI_EXACT.filter((e) => `${e} ` === head),
        head,
      ).toEqual([]);
    expect(new Set(UI_EXACT).size).toBe(UI_EXACT.length);
    expect(new Set(UI_HEADS).size).toBe(UI_HEADS.length);
  });

  it("refuses a bare `ui` and an unknown line", () => {
    expect(isUiLine("")).toBe(false);
    expect(isUiLine("track mute melody")).toBe(false);
  });
});
