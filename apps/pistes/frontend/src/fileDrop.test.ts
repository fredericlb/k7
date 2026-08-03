import { PARAM_MIME } from "@studio/ui-module-builder/param-drag";
import { describe, expect, it } from "vitest";
import { acceptsFileDrop } from "./fileDrop";

// This predicate decides whether `dragover` calls preventDefault, and a `dragover` that
// doesn't is a drop the browser refuses in SILENCE — no handler, no error, no highlight.
// So a false negative here is indistinguishable from the feature having been removed,
// which is why it is a pure function with tests rather than an inline expression.

describe("acceptsFileDrop", () => {
  it("accepts the canonical OS file drag", () => {
    // What Chromium puts in `types` when you drag from a file manager.
    expect(acceptsFileDrop({ types: ["Files"] })).toBe(true);
    expect(acceptsFileDrop({ types: ["Files"], itemKinds: ["file"] })).toBe(
      true,
    );
  });

  it("accepts a drag that only says so through its items", () => {
    // Some sources populate `items` but not `types` during dragover. Requiring "Files"
    // alone refused these, and the refusal looked like nothing happening at all.
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
    // Dragging a parameter onto a widget is page-local: there is nothing to upload, and
    // treating it as one would hand the tree a drop it can't act on.
    expect(acceptsFileDrop({ types: [PARAM_MIME] })).toBe(false);
    expect(
      acceptsFileDrop({ types: [PARAM_MIME, "Files"], itemKinds: ["file"] }),
    ).toBe(false);
  });
});
