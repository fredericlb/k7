// highlight.ts — a lane HIGHLIGHTED from the mixer: heard 10 dB up while it is on, its fader left
// where it is. The boost is the engine's output stage on the lane's strip (`@output-volume`, which
// reaches +12 where the fader stops at +6), so switching it off returns exactly the mix that was.
// The list is project state, `highlighted:` beside `soloed:`. See docs/highlight.md.

import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { OUTPUT_VOLUME_PARAM } from "@studio/song-schema/moduleTypes";
import type { PluginDoc } from "./project";

/** How much louder a highlighted lane plays, dB. */
export const HIGHLIGHT_DB = 10;
/** The output stage's ceiling, the engine's own (engine docs/mix.md). */
const STAGE_MAX_DB = 12;

/** A lane's plugins with its strip — the LAST mixer of the run — set to play `HIGHLIGHT_DB` louder. */
export function highlighted(plugins: PluginDoc[]): PluginDoc[] {
  let at = -1;
  for (let i = plugins.length - 1; i >= 0 && at < 0; i--)
    if (plugins[i].type === MIXER_PLUGIN) at = i;
  if (at < 0) return plugins;
  return plugins.map((p, i) =>
    i === at
      ? {
          ...p,
          params: {
            ...p.params,
            // ON TOP of whatever level the strip's stage already had, up to the stage's own +12 dB.
            [OUTPUT_VOLUME_PARAM]: Math.min(
              STAGE_MAX_DB,
              (Number(p.params[OUTPUT_VOLUME_PARAM]) || 0) + HIGHLIGHT_DB,
            ),
          },
        }
      : p,
  );
}
