import { validateFile } from "@studio/song/yaml/validate";
import { describe, expect, it } from "vitest";
import {
  decideAutosave,
  dropBuffer,
  keepBuffer,
  recallBuffer,
} from "./autosave";

const at = (path: string, text: string) => validateFile(path, text);
const MODULE = "modules/audio/cab/module.yaml";

describe("decideAutosave", () => {
  it("does nothing when the buffer is what is on disk", () => {
    expect(
      decideAutosave({
        dirty: false,
        validity: at(MODULE, "extends: amp\n"),
        baselineOk: true,
      }).act,
    ).toBe("idle");
  });

  it("writes a valid buffer", () => {
    expect(
      decideAutosave({
        dirty: true,
        validity: at(MODULE, "extends: amp\n"),
        baselineOk: true,
      }),
    ).toEqual({ act: "write", reason: null });
  });

  it("holds a buffer that would not compile, and says why", () => {
    const d = decideAutosave({
      dirty: true,
      validity: at(MODULE, "extends: amp\nparamz: 1\n"),
      baselineOk: true,
    });
    expect(d.act).toBe("hold");
    expect(d.reason).toContain("paramz");
  });

  it("holds text that does not parse even when disk is already refused", () => {
    // Nothing may write a document YAML itself cannot read: it would not survive a re-read.
    expect(
      decideAutosave({
        dirty: true,
        validity: at(MODULE, "params: {a: 1\n"),
        baselineOk: false,
      }).act,
    ).toBe("hold");
  });

  it("writes a schema-invalid buffer when the FILE was already invalid", () => {
    // Otherwise the file is uneditable forever: nothing you type can make it valid, and there
    // is no Save button left to overrule the check with.
    const d = decideAutosave({
      dirty: true,
      validity: at(MODULE, "paramz: 1\ndocs: hello\n"),
      baselineOk: false,
    });
    expect(d.act).toBe("write");
    expect(d.reason).toContain("paramz"); // still said out loud
  });

  it("writes anything for a file no schema claims", () => {
    expect(
      decideAutosave({
        dirty: true,
        validity: at("songs/pearl/song.yaml", "title: Pearl\nanything: yes\n"),
        baselineOk: true,
      }).act,
    ).toBe("write");
  });
});

describe("the held buffers", () => {
  it("survive the pane that was showing them", () => {
    keepBuffer("tracks/lead.yaml", "type: singl\n");
    expect(recallBuffer("tracks/lead.yaml")).toBe("type: singl\n");
    dropBuffer("tracks/lead.yaml");
    expect(recallBuffer("tracks/lead.yaml")).toBeNull();
  });
});
