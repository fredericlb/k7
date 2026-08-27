// The card a CAMERA node draws. `@engine/CAM` has no folder, so it can carry no `ui.yaml` — which
// is why this panel is synthesised and not authored, and why getting it wrong would leave every
// camera in every project reading "No Options". See packages/song/docs/camera.md.

import type { WebGraph } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import { buildGraph, CAMERA_BIND, cameraUI } from "./graph";

const HERE = ["FaceTime HD Camera", "Logitech BRIO"];

describe("the dropdown", () => {
  it("offers every lens the browser can see, writing the LABEL", () => {
    const w = cameraUI(HERE, "").widgets.camera;
    expect(w.type).toBe("dropdown");
    expect(w.bind).toBe(CAMERA_BIND);
    expect(w.options?.map((o) => o.label)).toEqual(["default", ...HERE]);
    // `arg` is what the command writes — the label, verbatim, since that is what the file says.
    expect(w.options?.map((o) => o.arg)).toEqual([
      "default",
      "FaceTime HD Camera",
      "Logitech BRIO",
    ]);
  });

  it("offers `default` FIRST and always, so a chosen lens can be un-chosen", () => {
    // Without it the only way back to the machine's own camera is editing the file by hand.
    expect(cameraUI([], undefined).widgets.camera.options).toEqual([
      { label: "default", value: 0, arg: "default" },
    ]);
  });
});

/** A lens wired to a picture lane — what the file service sends once `camera` is on the step. */
const GRAPH: WebGraph = {
  chains: {
    cam: {
      use: [{ module: "cam", category: "io", camera: "Logitech BRIO" }],
      out: [{ to: "main", gain: 1 }],
    },
  },
  tracks: [],
  videoTracks: ["main"],
  warnings: [],
};

describe("the card it draws", () => {
  it("carries the panel, and the lens it is on", () => {
    const { nodes } = buildGraph(GRAPH, { cameras: HERE });
    const card = nodes.find((n) => n.module === "cam");
    expect(card?.ui?.widgets.camera.bind).toBe(CAMERA_BIND);
    // Carried, not consumed: the renderer reads it back to know which entry is current.
    expect(card?.camera).toBe("Logitech BRIO");
  });

  it("still draws a panel on a machine with no camera at all", () => {
    // "No Options" on a node whose whole purpose is a choice reads as a broken app.
    const card = buildGraph(GRAPH).nodes.find((n) => n.module === "cam");
    expect(card?.ui?.widgets.camera.options).toHaveLength(1);
  });

  it("leaves a step that is not a lens alone", () => {
    const plain: WebGraph = {
      ...GRAPH,
      chains: { a: { use: [{ module: "reverb" }], out: [] } },
    };
    const card = buildGraph(plain, { cameras: HERE }).nodes.find(
      (n) => n.module === "reverb",
    );
    expect(card?.ui).toBeUndefined();
  });
});
