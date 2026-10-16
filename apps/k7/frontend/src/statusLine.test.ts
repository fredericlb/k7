// The status line's store: one notification per CHANGE, so a drag re-stating its line costs nothing.

import { describe, expect, it } from "vitest";
import { createStatusLine } from "./statusLine";

describe("createStatusLine", () => {
  it("notifies on a new line and stays quiet on the same one", () => {
    const s = createStatusLine();
    let calls = 0;
    s.subscribe(() => calls++);
    s.say("caret: bass, beat 1", false);
    s.say("caret: bass, beat 1", false);
    expect(calls).toBe(1);
    expect(s.get()).toEqual({
      text: "caret: bass, beat 1",
      refused: false,
      hint: "",
    });
  });

  it("the same text as a refusal is a change", () => {
    const s = createStatusLine();
    s.say("no", false);
    const before = s.get();
    s.say("no", true);
    expect(s.get()).not.toBe(before);
    expect(s.get().refused).toBe(true);
  });

  it("a hint borrows the line and leaves the app's word underneath", () => {
    const s = createStatusLine();
    s.say("saved", false);
    s.hint("deletes the clip");
    s.hint("");
    expect(s.get()).toEqual({ text: "saved", refused: false, hint: "" });
  });

  it("an unsubscribed listener hears nothing", () => {
    const s = createStatusLine();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    off();
    s.say("x", false);
    expect(calls).toBe(0);
  });
});
