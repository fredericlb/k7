// LaneVstFreeze.tsx — the gutter snowflake on a lane whose VST the engine does not have: solid when
// the lane plays its automatic render, faded while no render is made yet and the lane plays without
// the VST. Says only; thawing is the chains pane's (packages/song/docs/autoFreeze.md).

import { Snowflake } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { m } from "../../paraglide/messages.js";

export function LaneVstFreeze({
  rendered,
  waiting,
}: {
  /** The VST module whose render this lane plays, when it does. */
  rendered?: string;
  /** The VST module the engine lacks, while no render stands in for it. */
  waiting?: string;
}) {
  const vst = rendered ?? waiting;
  if (!vst) return null;
  const title = rendered
    ? m["laneFreeze.rendered"]({ vst })
    : m["laneFreeze.waiting"]({ vst });
  return (
    <span
      className={cn(
        "ml-1 inline-flex shrink-0 text-sky-400",
        !rendered && "opacity-50",
      )}
      role="img"
      title={title}
      aria-label={title}
    >
      <Snowflake className="h-3 w-3" />
    </span>
  );
}
