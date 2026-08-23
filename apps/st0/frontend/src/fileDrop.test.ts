import { PARAM_MIME } from "@studio/ui-module-builder/param-drag";
import { describe, expect, it } from "vitest";
import { acceptsFileDrop } from "./fileDrop";

// This predicate decides whether `dragover` calls preventDefault, and a `dragover` that does not is a drop the browser refuses in SILENCE.

describe("acceptsFileDrop", () => {
  it("accepts the canonical OS file drag", () => {
    // What Chromium puts in `types` when you drag from a file manager.
    expect(acceptsFileDrop({ types: ["Files"] })).toBe(true);
    expect(acceptsFileDrop({ types: ["Files"], itemKinds: ["file"] })).toBe(
      true,
    );
  });

  it("accepts a drag that only says so through its items", () => {
    // Some sources populate `items` but not `types` during dragover: requiring 'Files' alone refused them, and it looked like nothing happening.
    expect(acceptsFileDrop({ types: [], itemKinds: ["file"] })).toBe(true);
    expect(
      acceptsFileDrop({ types: ["text/plain"], itemKinds: ["file", "string"] }),
    ).toBe(true);
  });

  it("refuses a drag carrying no file at all", () => {
    expect(acceptsFileDrop({ types: [] })).toBe(false);
    expect(
      acceptsFileDrop({ types: ["text/plain"], itemKinds: ["string"] }),
    ).toBe(false);
    expect(acceptsFileDrop({ types: ["text/uri-list"] })).toBe(false);
  });

  it("refuses an internal param drag whatever else it claims", () => {
    // Dragging a parameter onto a widget is page-local: there is nothing to upload, and the tree could not act on such a drop.
    expect(acceptsFileDrop({ types: [PARAM_MIME] })).toBe(false);
    expect(
      acceptsFileDrop({ types: [PARAM_MIME, "Files"], itemKinds: ["file"] }),
    ).toBe(false);
  });
});
