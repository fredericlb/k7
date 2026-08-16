// normalize.ts — bring a clip (or a whole track's clips) up to a target peak, IN PLACE.
//
// The engine has done the arithmetic all along (`--normalize`, one shared gain across every file it is
// given, so the loudest reaches the target and the rest keep their relative levels); nothing called it.
// This is the caller: it decides WHICH files, backs each one up through the host's journal, and reports
// the gain that was applied.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, relative } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { type ProcessResult, resolveTargets, type Scope } from "./processChain";

/**
 * The default target, in linear peak. −1 dBFS rather than 0: a file peaking at exactly full scale clips on
 * any resampling or lossy encode downstream, and a take is rarely the last thing to touch the samples.
 */
export const DEFAULT_PEAK = 0.891;

/**
 * Normalise every source behind `target`, writing each file back over itself.
 *
 * In place, and safe to be: the engine loads every input fully before it writes any output, so a file is
 * already in memory when its own bytes are replaced. What makes it *undoable* is `beforeWrite` — the same
 * hook the chain bounce uses, which the web host points at its journal, so Ctrl+Z brings the take back.
 *
 * `window` bounds the operation to the interval a clip PLAYS (`from`/`to`, in file seconds): the peak is
 * measured there and the gain lands there, so the material outside the window keeps its bytes — a louder
 * count-in the window was trimmed to exclude neither caps the gain nor gets pushed over full scale.
 * `to` may be Infinity ("to the end"); the engine reads it as the file's end. Null is the whole file.
 *
 * WAV only, and that is a real limit rather than caution: the engine writes WAV whatever it read, so
 * normalising an mp3 over itself would leave WAV bytes behind an `.mp3` name — a file that plays here and
 * nowhere else. Recorded takes are WAV, which is the case this exists for.
 */
export function normalizeInPlace(
  dir: string,
  project: ProjectDoc,
  target: string,
  scope: Scope,
  engineBin: string | null,
  peak = DEFAULT_PEAK,
  beforeWrite?: (absPath: string) => void,
  window?: { from: number; to: number } | null,
): ProcessResult {
  const verb = `${scope} normalize`;
  if (!(peak > 0 && peak <= 1))
    return {
      lines: [`${verb}: peak must be over 0 and at most 1 (got ${peak})`],
      changed: false,
    };

  let sources: string[];
  let label: string;
  try {
    const t = resolveTargets(dir, project, target, scope);
    sources = t.sources;
    label = t.label;
  } catch (e) {
    return { lines: [`${verb}: ${(e as Error).message}`], changed: false };
  }

  const show = (s: string) => relative(dir, s).split("\\").join("/");
  const missing = sources.filter((s) => !existsSync(s));
  if (missing.length)
    return {
      lines: [
        `missing source(s) for ${label}: ${missing.map(show).join(", ")}`,
      ],
      changed: false,
    };

  const notWav = sources.filter((s) => extname(s).toLowerCase() !== ".wav");
  if (notWav.length)
    return {
      lines: [
        `${verb}: only WAV can be normalised in place — ${notWav
          .map(show)
          .join(", ")} would be rewritten as WAV behind its own name`,
      ],
      changed: false,
    };

  if (!engineBin)
    return {
      lines: [
        `${verb} failed: studio-moteur binary not found (build the engine)`,
      ],
      changed: false,
    };

  // Backed up BEFORE the engine runs, and all of them: it writes every output in one pass, so there is no
  // moment where undoing half of it would be right.
  for (const s of sources) beforeWrite?.(s);

  // Quadruples on the wire: <in> <out> <fromSec> <toSec>, with -1 meaning "the file's end" —
  // Infinity does not survive String() as something atof can read.
  const from = String(Math.max(0, window?.from ?? 0));
  const to =
    window && Number.isFinite(window.to) && window.to > 0
      ? String(window.to)
      : "-1";
  const r = spawnSync(
    engineBin,
    ["--normalize", String(peak), ...sources.flatMap((s) => [s, s, from, to])],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (r.status !== 0)
    return {
      lines: [`${verb} failed: engine exited ${r.status ?? "?"}`],
      changed: false,
    };

  // The manifest's `gain` is what actually happened, and it is the only interesting number: a take already
  // at the target reports 1.0, which is how "nothing to do" says itself.
  const line =
    (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  let gain: number | null = null;
  try {
    gain = Number((JSON.parse(line) as { gain?: number }).gain ?? Number.NaN);
  } catch {
    gain = null;
  }
  const dB = gain && gain > 0 ? 20 * Math.log10(gain) : null;
  // Say the bounds out loud when there are any: "normalised" with no qualifier reads as the file.
  const where = window
    ? ` within ${from}s → ${to === "-1" ? "end" : `${to}s`}`
    : "";
  return {
    lines: [
      `normalised ${label} to ${peak} peak${where}` +
        (dB === null ? "" : ` (${dB >= 0 ? "+" : ""}${dB.toFixed(1)} dB)`),
    ],
    changed: true,
  };
}
