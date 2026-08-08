// scaffoldV1.ts — the file map + writer for a new v1 CUT: a viewport, a full-frame lane and a
// picture-in-picture over it, both playing the bundled sample so the compositing is visible at
// first open. Hand-authored like the other two scaffolds and for the same reason — the `#`
// comments ship to disk and are the one worked example a reader gets.
// Full rationale: docs/v1Project.md.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeProjectFiles } from "./scaffold";

const q = (s: string) => JSON.stringify(s);

// The bundled sample: testsrc burns the frame number in, so a sync problem is visible at a glance.
const SAMPLE_VIDEO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
  "video",
  "sample.mp4",
); // packages/song/samples/video/sample.mp4

/** The files of a minimal v1 cut, keyed by path relative to the project folder. */
export function v1ProjectFiles(name: string): Record<string, string> {
  return {
    "project.yaml":
      `# \`type\` is a ROOT key, beside \`markers\` — a fact about what these files ARE, not one\n` +
      `# of the project's own settings under \`project:\`.\n` +
      `#\n` +
      `# The folder's \`.v1\` suffix is what actually decides which app opens this, and it wins\n` +
      `# if the two ever disagree. This line is here so a reader — and a loader handed the\n` +
      `# folder by absolute path, with no name to read — knows too.\n` +
      `type: v1\n` +
      `project:\n` +
      `  name: ${q(name)}\n` +
      `\n` +
      `  # The frame every lane draws into: [width, height, fps]. Required — there is no\n` +
      `  # defensible default, since a frame invented here would silently letterbox every shot.\n` +
      `  # The fps is used by EXPORT only; playing back follows the transport's own clock.\n` +
      `  viewport: [1280, 720, 30]\n` +
      `\n` +
      `  # Draw order, bottom first. It is the ORDER and the membership at once: a name with no\n` +
      `  # file is an error, and a lane no name lists is an error too — otherwise it would\n` +
      `  # compile perfectly and simply never appear.\n` +
      `  layers: [main, pip]\n` +
      `\n` +
      `# Named points on the cut, in WALL-CLOCK seconds — \`90\`, \`12.5\`, \`1:30.5\`. Quoted, like\n` +
      `# every position in these files: unquoted, YAML 1.1 reads \`1:30\` as sexagesimal.\n` +
      `# markers:\n` +
      `#   "0": "cold open"\n` +
      `#   "1:30.5": "the cut"\n`,

    "clips/sample.yaml":
      `# A SOURCE, not a placement: this says which file, and video_tracks/ says where it goes.\n` +
      `# One clip file can be placed any number of times, on any number of lanes.\n` +
      `source: clips/sample.mp4\n`,

    // The full-frame background lane: x/y/w/h place it in viewport px, source_from is the in-point in seconds.
    "video_tracks/main.yaml":
      `# A lane of picture. Every time here is DECIMAL SECONDS — a cut is made against the wall\n` +
      `# clock, which is the whole reason this is not l8's timeline.\n` +
      `#\n` +
      `# \`length: 0\` runs to the end of the source; \`source_from\` trims the head. \`mute\`\n` +
      `# means HIDDEN — there is no sound on a lane.\n` +
      `#\n` +
      `# x/y/w/h place the lane inside the viewport; omit them for the full frame.\n` +
      `kind: video\n` +
      `# name: "A-roll"     # the lane's label; the FILENAME is still its id\n` +
      `x: 0\ny: 0\nw: 1280\nh: 720\n` +
      `clips:\n  - { ref: sample, start: 0, length: 6, source_from: 0 }\n`,

    // A picture-in-picture lane over "main", playing the same clip from 2s in — proof the compositing works.
    "video_tracks/pip.yaml":
      `# The same source, two seconds in, in the corner over "main" — which is what makes the\n` +
      `# compositing visible on the first open rather than after you have built something.\n` +
      `kind: video\n` +
      `x: 940\ny: 520\nw: 320\nh: 180\n` +
      `clips:\n  - { ref: sample, start: 0, length: 6, source_from: 2 }\n`,
  };
}

/**
 * Write a new v1 cut into `dir`, returning every path written (project-relative).
 *
 * The sample is COPIED rather than referenced where it sits: a project that points into the
 * installed package is one that stops opening the day the package moves, and a cut is a folder
 * you commit.
 */
export function scaffoldV1(dir: string, name: string): string[] {
  const files = v1ProjectFiles(name);
  writeProjectFiles(dir, files);

  if (!existsSync(SAMPLE_VIDEO))
    throw new Error(
      `bundled sample video missing (${SAMPLE_VIDEO}) — the @studio/song package is incomplete`,
    );
  mkdirSync(join(dir, "clips"), { recursive: true });
  copyFileSync(SAMPLE_VIDEO, join(dir, "clips/sample.mp4"));

  return [...Object.keys(files), "clips/sample.mp4"];
}
