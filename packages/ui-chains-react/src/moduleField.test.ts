// One case per intrinsic a dropdown can SET, because setting one and never showing it back is a
// control that looks broken and is not: the command lands, the file changes, the select does not
// move. That is exactly what a missing arm in `moduleFieldValue` produces.

import type { WebWidget } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";
import {
  cameraUI,
  inputUI,
  midiInUI,
  recBindVerb,
} from "@studio/ui-chains/graph";
import { describe, expect, it } from "vitest";
import { moduleFieldValue } from "./moduleField";

/** A card carrying whichever fields the case is about — the rest of a node is not read here. */
const node = (fields: Partial<GraphNode>): GraphNode =>
  ({ id: "n", label: "n", ...fields }) as GraphNode;

const CAMS = ["Logitech BRIO", "FaceTime HD"];
const camWidget = (): WebWidget =>
  cameraUI(CAMS, undefined).widgets.camera as WebWidget;

/** What the select would show: the option whose value came back, or "—" for nothing. */
const shown = (n: GraphNode, w: WebWidget, field: string): string => {
  const v = moduleFieldValue(n, w, field);
  return v === undefined
    ? "—"
    : (w.options?.find((o) => o.value === v)?.label ?? "—");
};

describe("the camera dropdown", () => {
  it("shows the lens the file names", () => {
    expect(shown(node({ camera: "FaceTime HD" }), camWidget(), "camera")).toBe(
      "FaceTime HD",
    );
  });

  it('shows "default" for the empty string, which is a lens too', () => {
    // "" means whichever camera this machine calls default — see packages/song/docs/camera.md.
    expect(shown(node({ camera: "" }), camWidget(), "camera")).toBe("default");
  });

  it("shows nothing for a node that is not a camera at all", () => {
    expect(shown(node({}), camWidget(), "camera")).toBe("—");
  });

  it("shows nothing for a lens this machine has not got", () => {
    // The options ARE the machine's list, so only a hand-written file reaches this.
    expect(shown(node({ camera: "Blackmagic" }), camWidget(), "camera")).toBe(
      "—",
    );
  });

  it("moves when the file does — the whole of what the bug was", () => {
    const w = camWidget();
    const before = moduleFieldValue(node({ camera: "" }), w, "camera");
    const after = moduleFieldValue(
      node({ camera: "Logitech BRIO" }),
      w,
      "camera",
    );
    expect(before).not.toBe(after);
  });
});

describe("the input node's own three", () => {
  const ui = inputUI(
    [
      { name: "Mic 1", channels: [1] },
      { name: "Mic 2", channels: [2] },
    ],
    [2],
  );

  it("shows which socket the file is on, matched on the CHANNELS", () => {
    const w = ui.widgets.channel as WebWidget;
    expect(shown(node({ channel: [2] }), w, "channel")).toBe("Mic 2");
    expect(shown(node({}), w, "channel")).toBe("—");
  });

  it("shows the width the channel list implies", () => {
    const w = ui.widgets.width as WebWidget;
    expect(shown(node({ channel: [2] }), w, "width")).toBe("—"); // not this widget's field
    expect(shown(node({ channel: [2] }), w, "channel")).toBe("mono");
    expect(shown(node({ channel: [1, 2] }), w, "channel")).toBe("stereo");
  });

  it("shows the monitoring the file names", () => {
    const w = ui.widgets.monitor as WebWidget;
    expect(shown(node({ monitor: "on" }), w, "monitor")).toBe("on");
    expect(shown(node({ monitor: "off" }), w, "monitor")).toBe("off");
  });
});

describe("the folder-backed two", () => {
  const w = (labels: string[]): WebWidget =>
    ({
      type: "dropdown",
      col: 0,
      row: 0,
      options: labels.map((label, i) => ({ label, value: i })),
    }) as WebWidget;

  it("reads a base back, and an unset one as `none`", () => {
    expect(shown(node({ base: "warm" }), w(["none", "warm"]), "base")).toBe(
      "warm",
    );
    expect(shown(node({}), w(["none", "warm"]), "base")).toBe("none");
  });

  it("reads a shader back the same way", () => {
    expect(shown(node({ shader: "blur" }), w(["none", "blur"]), "shader")).toBe(
      "blur",
    );
  });
});

// A recorder's controls are `@rec:record` and friends — intrinsics that FIRE. The prefix is not
// `@record` on purpose: a bare `@field` is what the general case tries to WRITE, so the three
// buttons would silently become field sets. See packages/ui-chains-react/docs/widgets.md.
describe("the recorder's binds", () => {
  it("names its three verbs, and nothing else", () => {
    expect(recBindVerb("@rec:record")).toBe("record");
    expect(recBindVerb("@rec:clear")).toBe("clear");
    expect(recBindVerb("@rec:save")).toBe("save");
  });

  it("refuses a verb it does not have", () => {
    // Answering "play" would send the engine a message it will not understand, and the button
    // would look wired. Null means the widget draws inert, which is the honest picture.
    expect(recBindVerb("@rec:play")).toBeNull();
    expect(recBindVerb("@rec:")).toBeNull();
  });

  it("is not confused with a module FIELD, or with a rack pad", () => {
    expect(recBindVerb("@monitor")).toBeNull();
    expect(recBindVerb("@camera")).toBeNull();
    expect(recBindVerb("@rack:BD")).toBeNull();
    expect(recBindVerb("Volume")).toBeNull();
    expect(recBindVerb(undefined)).toBeNull();
  });

  it("resolves as a FIRING target rather than a field to write", () => {
    // The bug this guards: `@rec:record` reaching the general `@` arm would resolve to a module
    // field called "rec:record", and pressing the button would write it into the node's file.
    const n = node({ module: "rec", kind: "module" });
    const w = {
      type: "button",
      col: 0,
      row: 0,
      bind: "@rec:record",
    } as WebWidget;
    expect(moduleFieldValue(n, w, "rec:record")).toBeUndefined();
    expect(recBindVerb(w.bind)).toBe("record");
  });
});

describe("the MIDI device dropdown", () => {
  const devWidget = (): WebWidget =>
    midiInUI(["Arturia KeyStep 37", "MiniLab"]).widgets.device as WebWidget;

  it("shows the device the file names", () => {
    expect(shown(node({ device: "MiniLab" }), devWidget(), "device")).toBe(
      "MiniLab",
    );
  });

  it('shows "any" for the empty string, which records from every device', () => {
    expect(shown(node({ device: "" }), devWidget(), "device")).toBe("any");
  });

  it("shows nothing for a node that is not a MIDI device", () => {
    expect(shown(node({}), devWidget(), "device")).toBe("—");
  });
});
