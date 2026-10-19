// The shell's dispatch table against the shell's catalogue. The claim is the one that makes
// the palette worth having: every action on screen is a command, and every command the palette
// lists is one the dispatcher will actually recognise.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  BARE_TRANSPORT,
  isUiLine,
  UI_EXACT,
  UI_HEADS,
  uiVerdict,
} from "./localCommands";
import { LOCAL_ARGS, LOCAL_COMMANDS } from "./palette";
import { runLocal } from "./ui/commands/dispatch";
import {
  findLocal,
  isUiCommand,
  LOCAL_REGISTRY,
  type LocalCtx,
  matchOf,
} from "./ui/commands/index";

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
    expect(isUiLine("file kick.k7x")).toBe(true); // `ui file` — open it
    for (const l of [
      "fs file new clips kick.k7x",
      "fs file rename a b",
      "fs file delete a",
      "fs folder new clips takes",
      "fs file new", // bare, as the bar dispatches it before its form is filled
    ])
      expect(isUiLine(l), l).toBe(false);
    // …and a file whose NAME starts with a verb is still a file to open.
    expect(isUiLine("file newsletter.k7x")).toBe(true);
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

  it("holds only the five that write nothing", () => {
    // The ones that are not here have branches or files of their own; a verb added without one would silently stop being journalled.
    expect([...BARE_TRANSPORT].sort()).toEqual([
      "transport panic",
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

// The registry against itself: one entry per name, each found by its own line, on its own side of the gate.
describe("the command registry", () => {
  it("names each command once", () => {
    const names = LOCAL_REGISTRY.map((c) => c.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("describes every command the palette lists", () => {
    const bare = LOCAL_REGISTRY.filter(
      (c) => c.listed !== false && !c.readable,
    );
    expect(bare.map((c) => c.name)).toEqual([]);
  });

  it("finds each command by its own line, with and without arguments", () => {
    for (const c of LOCAL_REGISTRY) {
      const ui = isUiCommand(c);
      expect(findLocal(asDispatched(withArgs(c.name)), ui), c.name).toBe(c);
      if (matchOf(c) !== "head")
        expect(findLocal(asDispatched(c.name), ui), c.name).toBe(c);
    }
  });

  it("never matches an argument-taking command whole only", () => {
    const wrong = LOCAL_REGISTRY.filter(
      (c) => c.args?.length && matchOf(c) === "exact",
    );
    expect(wrong.map((c) => c.name)).toEqual([]);
  });

  it("answers every bare transport verb, without listing it twice", () => {
    for (const line of BARE_TRANSPORT)
      expect(findLocal(line, false)?.listed, line).toBe(false);
  });
});

// A context that answers every field with a recording stub, so a line can be run without a shell.
function fakeCtx(over: Partial<LocalCtx> = {}) {
  const calls: string[] = [];
  const stub =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    };
  const ctx = new Proxy(over as LocalCtx, {
    get: (target, key: string) =>
      key in target ? target[key as keyof LocalCtx] : stub(key),
  });
  return { ctx, calls };
}

describe("runLocal — the registry as the dispatcher reads it", () => {
  const noServer = { isServerCommand: () => false };

  it("runs a `ui` line and refuses it unprefixed", () => {
    const zoomIn = vi.fn();
    const { ctx, calls } = fakeCtx({
      ...noServer,
      timelineRef: {
        current: { zoomIn },
      } as unknown as LocalCtx["timelineRef"],
    });
    expect(runLocal(ctx, "ui zoom")).toBe(true);
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(runLocal(ctx, "zoom")).toBe(true);
    expect(calls[0]).toContain("is a ui command");
  });

  it("hands an unknown line, and a server line sharing a `ui` head, to the server", () => {
    const { ctx } = fakeCtx({
      isServerCommand: (l) => l.startsWith("curve set"),
    });
    expect(runLocal(ctx, "track mute melody")).toBe(false);
    expect(runLocal(ctx, "curve set wob {}")).toBe(false);
  });

  it("creates a FOLDER with `fs folder new`, and a file with `fs file new`", () => {
    const createFolder = vi.fn();
    const createFile = vi.fn();
    const editor = {
      entries: () => ["clips"],
      isDir: () => true,
      createFolder,
      createFile,
    };
    const { ctx } = fakeCtx({
      ...noServer,
      editorRef: { current: editor } as unknown as LocalCtx["editorRef"],
    });
    runLocal(ctx, "fs folder new clips takes");
    expect(createFolder).toHaveBeenCalledWith("clips", "takes");
    runLocal(ctx, "fs file new clips kick.k7x");
    expect(createFile).toHaveBeenCalledWith("clips", "kick.k7x");
  });

  it("leaves a bare transport verb to the service while the engine socket is down", () => {
    const { ctx } = fakeCtx({
      ...noServer,
      frozen: false,
      connected: false,
      recordWithoutArmRef: { current: false },
    });
    expect(runLocal(ctx, "transport stop")).toBe(false);
  });
});

describe("uiVerdict — a `ui` head never swallows a server command", () => {
  // The server's catalogue, as the palette knows it: every `command:` of commands.yaml.
  const catalogue = (
    parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../packages/commands/commands.yaml",
        ),
        "utf8",
      ),
    ) as { command: string }[]
  ).map((c) => c.command);
  const isServer = (line: string) =>
    catalogue.some((c) => line === c || line.startsWith(`${c} `));

  it("sends `curve set` to the server though `ui curve` shares its first word", () => {
    expect(uiVerdict("curve set wob {}", false, isServer)).toBe("pass");
    expect(uiVerdict("curve point add wob 1:1 0.5", false, isServer)).toBe(
      "pass",
    );
    expect(uiVerdict("curve", true, isServer)).toBe("ui");
    expect(uiVerdict("curve wob", true, isServer)).toBe("ui");
  });

  it("still refuses a `ui` line typed without its prefix, and a prefix on a server line", () => {
    expect(uiVerdict("zoom", false, isServer)).toBe("refuse");
    expect(uiVerdict("node bypass amp", true, isServer)).toBe("refuse");
  });

  it("refuses NO server command unprefixed, whatever the `ui` heads are", () => {
    for (const c of catalogue)
      expect(uiVerdict(`${c} x`, false, isServer), c).not.toBe("refuse");
  });
});
