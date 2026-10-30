import { validateFile } from "@studio/song-schema/yaml/validate";
import { describe, expect, it } from "vitest";
import {
  baselineMemo,
  decideAutosave,
  dropBuffer,
  keepBuffer,
  recallBuffer,
  retriable,
  retryDelayMs,
} from "./autosave";

const at = (path: string, text: string) => validateFile(path, text);
const MODULE = "modules/audio/cab/module.k7x";

describe("decideAutosave", () => {
  it("does nothing when the buffer is what is on disk", () => {
    expect(
      decideAutosave({
        dirty: false,
        validity: at(MODULE, 'extends("amp")\n'),
        baselineOk: true,
      }).act,
    ).toBe("idle");
  });

  it("writes a valid buffer", () => {
    expect(
      decideAutosave({
        dirty: true,
        validity: at(MODULE, 'extends("amp")\n'),
        baselineOk: true,
      }),
    ).toEqual({ act: "write", reason: null });
  });

  it("holds a buffer that would not compile, and says why", () => {
    const d = decideAutosave({
      dirty: true,
      validity: at(MODULE, 'extends("amp")\nparamz(1)\n'),
      baselineOk: true,
    });
    expect(d.act).toBe("hold");
    expect(d.reason).toContain("paramz");
  });

  it("holds text that does not parse even when disk is already refused", () => {
    // Nothing may write a document k7x itself cannot read: it would not survive a re-read.
    expect(
      decideAutosave({
        dirty: true,
        validity: at(MODULE, "params({ a: 1\n"),
        baselineOk: false,
      }).act,
    ).toBe("hold");
  });

  it("writes a schema-invalid buffer when the FILE was already invalid", () => {
    // Otherwise the file is uneditable forever, since nothing typed can make it valid — see docs/autosave.md.
    const d = decideAutosave({
      dirty: true,
      validity: at(MODULE, 'paramz(1)\ncontent("hello")\n'),
      baselineOk: false,
    });
    expect(d.act).toBe("write");
    expect(d.reason).toContain("paramz"); // still said out loud
  });

  it("writes anything for a file no schema claims", () => {
    expect(
      decideAutosave({
        dirty: true,
        validity: at("songs/pearl/notes.txt", "title: Pearl\nanything: yes\n"),
        baselineOk: true,
      }).act,
    ).toBe("write");
  });
});

describe("the held buffers", () => {
  it("survive the pane that was showing them", () => {
    keepBuffer("tracks/lead.k7x", 'type("singl")\n');
    expect(recallBuffer("tracks/lead.k7x")).toBe('type("singl")\n');
    dropBuffer("tracks/lead.k7x");
    expect(recallBuffer("tracks/lead.k7x")).toBeNull();
  });
});

describe("baselineMemo", () => {
  it("judges the saved text once, however many times the timer fires", () => {
    let calls = 0;
    const judge = (path: string, text: string) => {
      calls++;
      return validateFile(path, text);
    };
    const baseline = baselineMemo();
    expect(baseline(judge, MODULE, 'extends("amp")\n')).toBe(true);
    expect(baseline(judge, MODULE, 'extends("amp")\n')).toBe(true);
    expect(calls).toBe(1);
  });

  it("judges again when the disk text or the file changes", () => {
    let calls = 0;
    const judge = (path: string, text: string) => {
      calls++;
      return validateFile(path, text);
    };
    const baseline = baselineMemo();
    baseline(judge, MODULE, 'extends("amp")\n');
    expect(baseline(judge, MODULE, "extends([\n")).toBe(false);
    baseline(judge, "modules/audio/amp/module.k7x", "extends([\n");
    expect(calls).toBe(3);
  });
});

describe("a failed write", () => {
  it("is tried again later each time, and never more than 30 s apart", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("is retried after a blip or a server fault, not after a refusal", () => {
    expect(retriable(new TypeError("Failed to fetch"))).toBe(true);
    expect(retriable(Object.assign(new Error("x"), { status: 502 }))).toBe(
      true,
    );
    expect(retriable(Object.assign(new Error("x"), { status: 409 }))).toBe(
      false,
    );
    expect(retriable(Object.assign(new Error("x"), { status: 400 }))).toBe(
      false,
    );
  });
});
