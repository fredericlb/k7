// moduleField.ts — what an INTRINSIC dropdown shows: the node's own field, read back as the
// position of the option that names it. Its own file so every intrinsic that can be SET has a
// test that it can also be SEEN — a missing arm here is a control that writes and never moves.
// See packages/ui-chains/docs/graphBuild.md.

import type { WebWidget } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";

/** The lens a card shows when the file names none — the label `cameraUI` puts first. */
const CAMERA_DEFAULT = "default";

/** …and the MIDI device, likewise — the label `midiInUI` puts first. */
const DEVICE_ANY = "any";

/** The value a dropdown bound to `@<field>` is currently on, or undefined when nothing names it. */
export function moduleFieldValue(
  n: GraphNode,
  w: WebWidget,
  field: string,
): number | undefined {
  // The socket and the width both write `channel:`, so both read it back through their `arg`.
  if (field === "channel") {
    if (!n.channel?.length) return undefined;
    const arg = n.channel.join(",");
    return w.options?.find((o) => o.arg === arg)?.value;
  }
  // Everything else is matched on the LABEL, which is the word written in the file.
  const current =
    field === "monitor"
      ? n.monitor
      : field === "base"
        ? (n.base ?? "none")
        : field === "shader"
          ? (n.shader ?? "none")
          : // "" is a lens too — the machine's own — so it reads back as the first option
            // rather than as nothing. Absent means this node is not a camera at all.
            field === "camera"
            ? n.camera === undefined
              ? undefined
              : n.camera === ""
                ? CAMERA_DEFAULT
                : n.camera
            : // A MIDI device the same way: "" is any device, the first option.
              field === "device"
              ? n.device === undefined
                ? undefined
                : n.device === ""
                  ? DEVICE_ANY
                  : n.device
              : undefined;
  if (current === undefined) return undefined;
  return w.options?.find((o) => o.label === current)?.value;
}

/** A PROJECT setting's current value, as the option index the node carries. Its own function
 *  because these are not module fields: nothing in the node's file says them, `buildGraph` puts
 *  them on the card from what the host knows — see @studio/ui-chains's `renderCard`. */
export function projectFieldValue(
  n: GraphNode,
  field: string,
): number | undefined {
  return field === "aspect" ? n.aspect : undefined;
}
