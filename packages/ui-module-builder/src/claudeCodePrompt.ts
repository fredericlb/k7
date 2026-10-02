// claudeCodePrompt.ts — AI organize handed to a LOCAL Claude Code session instead of the API: the same
// design brief and the same module, and in place of "return this JSON", which files to write and where,
// written directly by the session. Pure text, so it is tested without a clipboard. See docs/aiOrganize.md.
// The one thing a reader would get wrong: the paths name a REPOSITORY and a path in it, not a disk path.

import {
  type AiOrganizeRequest,
  aiUserPrompt,
  bindableNames,
} from "./aiOrganize";
import { aiDesignBrief } from "./aiPrompt";

/** Where the builder reads a module's two files, workspace-relative as the file service answers them. */
export interface PanelFiles {
  ui: string;
  /** Absent when the host keeps no widgets.js — the panel may then draw no screen. */
  script: string | null;
}

// A library's files are served under this virtual folder, and live in that library's own repository.
const LIBRARIES = /^_libraries\/([^/]+)\/(.+)$/;

/** A workspace path as a person finds it in a checkout: the library repository and the path in it, or the workspace's. */
export function whereIs(path: string): string {
  const lib = LIBRARIES.exec(path);
  return lib
    ? `\`${lib[2]}\` in the \`${lib[1]}\` library repository`
    : `\`${path}\` in the workspace repository`;
}

/** The whole prompt to paste into Claude Code: brief, module, what to change, and the files to write. */
export function claudeCodePrompt(
  req: AiOrganizeRequest,
  files: PanelFiles,
): string {
  const binds = bindableNames(req);
  return [
    aiDesignBrief(),
    "",
    "---",
    "",
    aiUserPrompt(req),
    "",
    "---",
    "",
    "# What to do",
    "",
    "You are working in a checkout of this module's repository. Write the panel DIRECTLY into its file — no JSON, no answer in chat:",
    "",
    `- the panel, \`ui.yaml\`: ${whereIs(files.ui)} — the complete file, \`cols\`, \`rows\`, \`widgets\` and nothing else, starting with a one-line \`#\` comment naming the module.`,
    files.script
      ? `- the screens, \`widgets.js\`: ${whereIs(files.script)} — one draw function per lcdscreen id (\`export default { … }\`). Leave it untouched when the panel has no lcdscreen.`
      : "- this module keeps no `widgets.js`, so the panel must draw no lcdscreen.",
    "",
    "Before you finish, check it the way the builder will, and fix what fails:",
    "- the YAML parses, and every widget lies inside `cols` × `rows` without overlapping another on the same tab (the top-level `widgets` are on every tab) — a `group` excepted, whose box wholly contains the widgets it frames;",
    "- every widget id is used once;",
    `- every \`bind\` and every \`pair\` is one of: ${binds.map((b) => `\`${b}\``).join(", ") || "(none — this module has no parameters)"};`,
    "- every group frames two or more widgets — none around a single one;",
    "- an EQ or tone band (Low, Mid, High, Bass, Treble, Presence, a shelf's or a peak's gain) is a fader, never a knob;",
    "- no knob, slider, fader or number on an `@` param — st0 draws the engine's stage in the card's header — and none on the plugin's own input/output level, mix, dry or wet;",
    "- every lcdscreen has a draw function, and `widgets.js` compiles;",
    "- no screen has a `pointer` handler unless the author's direction above explicitly asks for an interactive screen.",
    "",
    "Touch no other file. Then say in two or three sentences what the layout does and what each screen shows.",
  ].join("\n");
}
