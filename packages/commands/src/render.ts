// render.ts — offline mixdown through the C++ engine, plus the radiok7 publish flow, shared
// so the web and the CLI drive the SAME render the engine does live. The engine writes
// WAV; mp3/flac are an optional ffmpeg transcode, so a missing ffmpeg only costs the
// compressed formats. shareToRadiok7 renders a mixdown + stems and uploads a release.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  loadProject,
  MIXER_PARAMS,
  MIXER_PLUGIN,
  type ProjectDoc,
} from "@studio/song/project";
import { setFileValue } from "@studio/song/yaml/edit";

// The engine's render manifest: the mixdown plus, with `--stems`, one wav per audible track, relative to out.
export interface RenderManifest {
  mix: string;
  stems: { name: string; file: string }[];
}

// Render `doc` through a SEPARATE, short-lived engine — never the one serving live playback. Throws its output.
export function renderMixdown(
  engineBin: string,
  doc: ProjectDoc,
  outDir: string,
  opts: { stems?: boolean } = {},
): RenderManifest {
  const docFile = join(outDir, "doc.json");
  writeFileSync(docFile, JSON.stringify(doc));
  const args = ["--render", docFile, "--out", outDir];
  if (opts.stems) args.push("--stems");
  const r = spawnSync(engineBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0)
    throw new Error(`engine render failed (exit ${r.status ?? "?"})`);
  const line =
    (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
  try {
    return JSON.parse(line) as RenderManifest;
  } catch {
    throw new Error(
      `could not read the engine's render manifest:\n${r.stdout}`,
    );
  }
}

/**
 * Bounce ONE track through its own modules to `outWav` — the render a frozen track then plays instead of
 * computing itself. Same short-lived separate engine as a mixdown, for the same reason: the live one is busy
 * being an instrument.
 *
 * The doc is neutralised here rather than by the caller, because getting it wrong is silent. A frozen track keeps
 * its STRIP live — its mixer module survives the freeze, which is the whole point of freezing rather than
 * bouncing-and-replacing — so anything that module applies at render time would be applied a second time on
 * playback. Every one of its knobs is flattened, tone included: the strip stays, so none of it may bake in.
 * Mute is cleared for the same reason. Solo is neutralised
 * across the WHOLE song for a different reason: a track that isn't the soloed one renders as silence, and
 * freezing during a solo pass is exactly when you'd reach for it.
 */
export function freezeTrackRender(
  engineBin: string,
  doc: ProjectDoc,
  trackName: string,
  outWav: string,
): void {
  const flat: ProjectDoc = {
    ...doc,
    tracks: doc.tracks.map((t) => ({
      ...t,
      solo: false,
      ...(t.name === trackName
        ? {
            mute: false,
            plugins: t.plugins.map((p) =>
              p.type === MIXER_PLUGIN
                ? {
                    ...p,
                    params: Object.fromEntries(MIXER_PARAMS.map((k) => [k, 0])),
                  }
                : p,
            ),
          }
        : {}),
    })),
  };
  const tmp = mkdtempSync(join(tmpdir(), "tbfreeze-"));
  try {
    const docFile = join(tmp, "doc.json");
    writeFileSync(docFile, JSON.stringify(flat));
    const r = spawnSync(
      engineBin,
      ["--freeze", docFile, "--track", trackName, "--out", outWav],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (r.status !== 0)
      // The engine's own line says WHICH way it failed (no such track, nothing audible); passing it through beats
      // an exit code the user then has to go and look up.
      throw new Error(
        (r.stderr || "").trim().split(/\r?\n/).filter(Boolean).pop() ||
          `engine freeze failed (exit ${r.status ?? "?"})`,
      );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// mp3 for the mixdown, flac for stems. Best-effort: a caller falls back to the raw wav.
export const MP3_CODEC = ["-c:a", "libmp3lame", "-q:a", "2"];
export const FLAC_CODEC = ["-c:a", "flac"];

// Transcode via ffmpeg, returning whether the file appeared — false when ffmpeg is missing, so the wav is kept.
export function transcode(
  inputWav: string,
  outPath: string,
  codec: string[],
): boolean {
  try {
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputWav,
        ...codec,
        outPath,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    return r.status === 0 && existsSync(outPath);
  } catch {
    return false; // ffmpeg not on PATH
  }
}

// --- radiok7 publish ---------------------------------------------------------

export interface Radiok7Config {
  url: string;
  token: string;
}

// Read `{ radiok7: { url, token } }` (flat radiok7Url/radiok7Token too) from a JSON file, or {} when absent or malformed.
function readRadiok7File(path: string): { url?: string; token?: string } {
  if (!existsSync(path)) return {};
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as {
      radiok7?: { url?: string; token?: string };
      radiok7Url?: string;
      radiok7Token?: string;
    };
    return {
      url: j.radiok7?.url ?? j.radiok7Url,
      token: j.radiok7?.token ?? j.radiok7Token,
    };
  } catch {
    return {}; // malformed — other sources can still supply values
  }
}

// The name of the per-workspace settings file that holds the radiok7 credentials.
export const WORKSPACE_SETTINGS = ".settings.json";

// radiok7 endpoint + token, resolved from .settings.json at the workspace root, then the env, then the legacy
// host-wide config. Returns an error message when either is still missing.
export function readRadiok7Config(
  workspaceRoot?: string,
): Radiok7Config | { error: string } {
  const ws = workspaceRoot
    ? readRadiok7File(join(workspaceRoot, WORKSPACE_SETTINGS))
    : {};
  const host = readRadiok7File(join(homedir(), ".lanes", "config.json"));
  const url = (ws.url || process.env.RADIOK7_URL || host.url || "").replace(
    /\/+$/,
    "",
  );
  const token = ws.token || process.env.RADIOK7_TOKEN || host.token || "";
  if (!url)
    return {
      error: `no radiok7 URL — add { "radiok7": { "url": "…" } } to ${WORKSPACE_SETTINGS} at the workspace root (or set RADIOK7_URL)`,
    };
  if (!token)
    return {
      error: `no radiok7 token — add { "radiok7": { "token": "…" } } to ${WORKSPACE_SETTINGS} at the workspace root (generate one in radiok7 Settings)`,
    };
  return { url, token };
}

// The song's stable id for radiok7, generating + persisting one into project.yaml if absent.
function ensureSongUuid(songDir: string, existing?: string): string {
  if (existing) return existing;
  const uuid = randomUUID();
  // The field is created whether or not `project:` exists, so the old "is its `project: { … }` present?" failure
  // — raised when a regex didn't match — has nothing left to report.
  setFileValue(join(songDir, "project.yaml"), ["project", "uuid"], uuid);
  return uuid;
}

export interface Radiok7Result {
  created: boolean;
  releaseId: string;
  title: string;
  stems: number;
}

// Publish to radiok7: render, transcode and upload as a release version. An unknown song throws NEEDS_META so the
// caller can prompt for artist/title. Needs the built engine; ffmpeg only improves the formats.
export const NEEDS_META = "NEEDS_META";

export async function shareToRadiok7(
  engineBin: string,
  songDir: string,
  cfg: Radiok7Config,
  opts: { artist?: string; title?: string; noStems?: boolean } = {},
): Promise<Radiok7Result> {
  if (!existsSync(join(songDir, "project.yaml")))
    throw new Error(
      "radiok7 needs a folder project (a directory with project.yaml)",
    );

  const doc = loadProject(songDir);
  const uuid = ensureSongUuid(songDir, doc.uuid);

  const auth = { Authorization: `Bearer ${cfg.token}` };
  // Does radiok7 already know this song? A 404 means it's new and needs artist/title.
  const lookup = await fetch(
    `${cfg.url}/api/releases/by-song/${encodeURIComponent(uuid)}`,
    { headers: auth },
  );
  const create = lookup.status === 404;
  if (!create && !lookup.ok)
    throw new Error(
      `radiok7 lookup failed: ${lookup.status} ${await lookup.text()}`,
    );
  if (create && !opts.artist) {
    const e = new Error(NEEDS_META);
    (e as Error & { defaultTitle?: string }).defaultTitle = doc.name;
    throw e;
  }

  const tmp = mkdtempSync(join(tmpdir(), "tbexport-"));
  try {
    const manifest = renderMixdown(engineBin, doc, tmp, {
      stems: !opts.noStems,
    });

    // Mixdown → mp3 when ffmpeg is present, else the raw wav.
    let mixPath = join(tmp, manifest.mix);
    let mixMime = "audio/wav";
    let mixName = "mix.wav";
    const mixMp3 = join(tmp, "mix.mp3");
    if (transcode(mixPath, mixMp3, MP3_CODEC)) {
      mixPath = mixMp3;
      mixMime = "audio/mpeg";
      mixName = "mix.mp3";
    }
    // Stems → flac, else wav.
    const stems = (opts.noStems ? [] : manifest.stems).map((s) => {
      const wav = join(tmp, s.file);
      const flac = join(tmp, `${basename(s.file, ".wav")}.flac`);
      return transcode(wav, flac, FLAC_CODEC)
        ? { name: s.name, path: flac, mime: "audio/flac" }
        : { name: s.name, path: wav, mime: "audio/wav" };
    });

    const form = new FormData();
    form.set("songUuid", uuid);
    form.set("versionName", new Date().toISOString());
    if (create) {
      form.set("artist", opts.artist ?? "");
      form.set("title", opts.title || doc.name);
    }
    form.set(
      "mixdown",
      new Blob([readFileSync(mixPath)], { type: mixMime }),
      mixName,
    );
    for (const s of stems)
      form.append(
        "tracks",
        new Blob([readFileSync(s.path)], { type: s.mime }),
        s.name,
      );

    const res = await fetch(`${cfg.url}/api/releases/import`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    if (!res.ok)
      throw new Error(`upload failed: ${res.status} ${await res.text()}`);
    const rel = (await res.json()) as { id: string; title: string };
    return {
      created: create,
      releaseId: rel.id,
      title: rel.title,
      stems: stems.length,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
