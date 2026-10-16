// pictureRender.ts — `picture render [webm|mp4] [wav|none] [size= quality= from= to=]`: the picture
// rendered on the SERVER, with no browser left open — in the background, since it takes as long
// as the song or longer, and into `exports/`. The words are the browser export's own, read by the
// one parser both use. See packages/file-service/docs/serverRender.md.

import { parseVideoSettings } from "@studio/song-schema/renderSettings";
import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

const FORMATS = ["webm", "mp4"] as const;

export const PICTURE_RENDER_VERBS: Record<string, SidHandler> = {
  "picture.render": async (a, h) => {
    const words = splitWords(a).map((w) => w.toLowerCase());
    const format = (FORMATS as readonly string[]).includes(words[0] ?? "")
      ? (words.shift() as "webm" | "mp4")
      : "webm";
    // The sound is the engine's mixdown, as the browser's export takes it; `none` makes a silent film.
    const audio =
      words[0] === "none"
        ? (words.shift(), false)
        : words[0] === "wav"
          ? (words.shift(), true)
          : true;
    const settings = parseVideoSettings(words);
    if (!settings) {
      h.refuse([
        "usage: picture render [webm|mp4] [wav|none] [size=720p|1280x720] [quality=low|medium|high|max] [from=<t>] [to=<t>]",
      ]);
      return;
    }
    if (!h.renderPicture) {
      h.refuse([
        "this host renders no picture — run `project export video` in the browser instead",
      ]);
      return;
    }
    const render = h.renderPicture;
    const work = async () => {
      const rel = await render({ format, audio, ...settings });
      return `picture rendered: ${rel}`;
    };
    if (h.background) {
      if (!h.background("picture render", work)) {
        h.refuse([
          "a picture render is already running — it writes into exports/ when it ends",
        ]);
        return;
      }
      h.log([
        `rendering the picture in the background (${format}${audio ? "" : ", silent"}) — it lands in exports/`,
      ]);
      return;
    }
    h.log([await work()]);
  },
};
