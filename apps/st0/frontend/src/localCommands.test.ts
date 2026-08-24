// The shell's dispatch table against the shell's catalogue. The claim is the one that makes
// the palette worth having: every action on screen is a command, and every command the palette
// lists is one the dispatcher will actually recognise.

import { describe, expect, it } from "vitest";
import { BARE_TRANSPORT, isUiLine, UI_EXACT, UI_HEADS } from "./localCommands";
import { LOCAL_ARGS, LOCAL_COMMANDS } from "./palette";

// What `runLocalCommand` sees: the line lowercased, with any `ui ` prefix already stripped.
const asDispatched = (name: string) =>
  name.replace(/^ui\s+/i, "").toLowerCase();

// A runnable line for a command: its name plus a placeholder per argument, which is what makes a HEAD match rather than an exact one.
const withArgs = (name: string) =>
  [name, ...(LOCAL_ARGS[name] ?? []).map((_, i) => `arg${i}`)].join(" ");

describe("every shell command is one the dispatcher recognises", () => {
  it("classifies each of them on the side of its own prefix", () => {
    // The pairing rule (docs/shell.md): a `ui` name must read as `ui`, a bare one must not, or the command lists, runs and is refused.
    const wrong = LOCAL_COMMANDS.filter((name) => {
      const line = asDispatched(withArgs(name));
      return isUiLine(line) !== /^ui\s/i.test(name);
    });
    expect(wrong, "commands the ui/bare gate would refuse").toEqual([]);
  });

  it("classifies them the same with no arguments typed yet", () => {
    // The bar dispatches the bare name for a command with no args, and holds one while its form fills — both must land on the same side.
    const wrong = LOCAL_COMMANDS.filter(
      (name) =>
        (LOCAL_ARGS[name] ?? []).length === 0 &&
        isUiLine(asDispatched(name)) !== /^ui\s/i.test(name),
    );
    expect(wrong).toEqual([]);
  });

  it("tells `ui file` from the TREE's verbs, which share no head with it", () => {
    // `file new x` against `ui file x` would be the one real collision: the tree's verbs are an `fs` group, and the group name settles it.
    expect(isUiLine("file kick.yaml")).toBe(true); // `ui file` — open it
    for (const l of [
      "fs file new clips kick.yaml",
      "fs file rename a b",
      "fs file delete a",
      "fs folder new clips takes",
      "fs file new", // bare, as the bar dispatches it before its form is filled
    ])
      expect(isUiLine(l), l).toBe(false);
    // …and a file whose NAME starts with a verb is still a file to open.
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

// The transport verbs the shell answers over the engine's own socket: what is worth pinning is that they stay OUT of `ui` and write nothing.
describe("the bare transport verbs", () => {
  it("are not `ui` lines — `ui` promises not to move the transport", () => {
    for (const line of BARE_TRANSPORT) expect(isUiLine(line)).toBe(false);
  });

  it("holds only the four that write nothing", () => {
    // The four that are not here have branches or files of their own; a verb added without one would silently stop being journalled.
    expect([...BARE_TRANSPORT].sort()).toEqual([
      "transport play",
      "transport rewind",
      "transport stop",
      "transport toggle",
    ]);
  });

  it("names them as the catalogue does, so a typed line reaches the same branch", () => {
    // The dispatcher matches the line whole and lowercased; every entry must already be that.
    for (const line of BARE_TRANSPORT) expect(line).toBe(line.toLowerCase());
  });
});
