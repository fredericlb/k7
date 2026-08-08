// What a right-click offers, and the one rule the whole menu rests on: an entry PRE-WRITES a
// command line, it never runs one. Every item is therefore a string the command bar could have
// been typed into — which is what makes the menu add no vocabulary of its own.

import { describe, expect, it } from "vitest";
import { contextMenu } from "./contextMenu";

const commands = (items: { command: string }[]) => items.map((i) => i.command);

describe("a module node", () => {
  it("offers unlink, so a node can leave the run from the graph it is drawn in", () => {
    // The graph passes the chain-step name, which for an instance IS the instance's name.
    expect(commands(contextMenu({ kind: "module", id: "lead" }))).toContain(
      "module instance unlink lead",
    );
  });

  it("puts it LAST — everything above reads or edits the node, this one takes it out", () => {
    const lines = commands(contextMenu({ kind: "module", id: "lead" }));
    expect(lines[lines.length - 1]).toBe("module instance unlink lead");
  });

  it("offers it on a DANGLING node too, where it is the actual repair", () => {
    // A name nothing answers to: there is no file to open and no param to set, but taking it
    // out of the run and closing the gap needs no module to exist. Both verbs here touch only
    // chains.yaml, which is why they are the two that survive `missing`.
    const lines = commands(
      contextMenu({ kind: "module", id: "gone", missing: true }),
    );
    expect(lines).toEqual([
      "module bypass gone",
      "module instance unlink gone",
    ]);
  });

  it("still offers `module own` rather than a file for an engine module", () => {
    // Guarding the branch the unlink entry was added beside: a scanned plugin has no file
    // anywhere, so offering `ui file` would open nothing.
    const lines = commands(
      contextMenu({ kind: "module", id: "nam", ambient: true }),
    );
    expect(lines).toContain("module own nam");
    expect(lines.join(" ")).not.toContain("ui file");
  });
});

describe("every entry is a command line", () => {
  it("never carries anything but text the bar could take", () => {
    // The contract in one assertion: no handlers, no ids to dispatch on — a label and a line.
    for (const ctx of [
      { kind: "module", id: "lead" },
      { kind: "module", id: "gone", missing: true },
      { kind: "track", id: "gtr" },
    ] as const)
      for (const item of contextMenu(ctx)) {
        expect(typeof item.command).toBe("string");
        expect(item.command.length).toBeGreaterThan(0);
        expect(Object.keys(item).sort()).toEqual(["command", "label"]);
      }
  });
});
