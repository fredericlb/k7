// mediatekRoot.ts — where the machine's media library is, and the `@st0` token a
// project uses to name it. Defined HERE, in song, although the rest of the `<state>`
// layout is engine-client's: engine-client imports song, never the reverse, so this is the
// only direction the dependency graph allows. `paths.ts` states the same rule for
// EXTS_PATH and delegates to song for exactly this reason.

import { join, resolve } from "node:path";
import { studioHome } from "./studioHome";

/** The ref PREFIX a médiathèque module is named under, defined in the leaf a browser may import. */
export { MEDIATEK_REF } from "@studio/song-schema/songRef";

/** `<state>/mediatek` or `$STUDIO_MEDIATEK`, NORMALISED so a text comparison cannot read `/` as escaping. */
export function mediatekRoot(): string {
  return resolve(process.env.STUDIO_MEDIATEK || join(studioHome(), "mediatek"));
}
