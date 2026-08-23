// samples.ts — resolve a Strudel sample name (+ variant index) to an absolute WAV, so `sound "bd sn"` plays
// real one-shots. Banks in order: the project's own samples/, then $DIRT_SAMPLES / $STRUDEL_SAMPLES, then the
// bundled kit. Each uses the Dirt layout `<name>/<NNN>.wav`, falling back to a flat `<name>.wav`.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "samples",
); // brain/samples

function wavsIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /\.wav$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function bankDirs(projectDir: string | null): string[] {
  const dirs: string[] = [];
  if (projectDir) dirs.push(join(projectDir, "samples"));
  if (process.env.DIRT_SAMPLES) dirs.push(process.env.DIRT_SAMPLES);
  if (process.env.STRUDEL_SAMPLES) dirs.push(process.env.STRUDEL_SAMPLES);
  dirs.push(BUNDLED);
  return dirs;
}

// Memoise resolutions (the clock resolves per event) — banks don't change within a session.
const memo = new Map<string, string | null>();

export function resolveSample(
  projectDir: string | null,
  name: string,
  index = 0,
): string | null {
  const key = `${projectDir ?? ""}|${name}|${index}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  let found: string | null = null;
  for (const bank of bankDirs(projectDir)) {
    const wavs = wavsIn(join(bank, name)); // <bank>/<name>/*.wav
    if (wavs.length) {
      found = wavs[((index % wavs.length) + wavs.length) % wavs.length];
      break;
    }
    const flat = join(bank, `${name}.wav`); // <bank>/<name>.wav
    if (existsSync(flat)) {
      found = flat;
      break;
    }
  }
  memo.set(key, found);
  return found;
}
