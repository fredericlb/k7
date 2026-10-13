// render.ts — offline mixdown through a Renderer (renderer.ts), plus the k7 publish flow, shared
// so the web and the CLI drive the SAME render the engine does live. The engine writes
// WAV; mp3/flac are an optional ffmpeg transcode, so a missing ffmpeg only costs the
// compressed formats. shareToK7 renders a mixdown + stems and uploads a release.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { freezeCut } from "@studio/song/freeze";
import { loadProject, type ProjectDoc } from "@studio/song/project";
import { setFileValue } from "@studio/song/yaml/edit";
import { type Renderer, renderToWav } from "./renderer";

export type { Renderer, RenderManifest } from "./renderer";

/** Bounce a freeze's upstream closure to `outWav` — a MIXDOWN of the plan, see docs/rendering.md. */
export function freezeUpstreamRender(
  render: Renderer,
  doc: ProjectDoc,
  plan: { lanes: Set<string>; modules: Set<string> },
  outWav: string,
): Promise<void> {
  return renderToWav(render, freezeCut(doc, plan), outWav);
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

// --- k7 publish ---------------------------------------------------------

export interface K7Config {
  url: string;
  token: string;
}

/** Read `{ k7: { url, token } }` from a JSON file — `radiok7` is read too, see docs/rendering.md. */
function readK7File(path: string): { url?: string; token?: string } {
  if (!existsSync(path)) return {};
  type Pair = { url?: string; token?: string };
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as {
      k7?: Pair;
      k7Url?: string;
      k7Token?: string;
      radiok7?: Pair;
      radiok7Url?: string;
      radiok7Token?: string;
    };
    return {
      url: j.k7?.url ?? j.k7Url ?? j.radiok7?.url ?? j.radiok7Url,
      token: j.k7?.token ?? j.k7Token ?? j.radiok7?.token ?? j.radiok7Token,
    };
  } catch {
    return {}; // malformed — other sources can still supply values
  }
}

// The name of the per-workspace settings file that holds the k7 credentials.
export const WORKSPACE_SETTINGS = ".settings.json";

// k7 endpoint + token, from .settings.json, then the env, then the host-wide config.
export function readK7Config(
  workspaceRoot?: string,
): K7Config | { error: string } {
  const ws = workspaceRoot
    ? readK7File(join(workspaceRoot, WORKSPACE_SETTINGS))
    : {};
  const host = readK7File(join(homedir(), ".studio", "config.json"));
  const url = (ws.url || process.env.K7_URL || host.url || "").replace(
    /\/+$/,
    "",
  );
  const token = ws.token || process.env.K7_TOKEN || host.token || "";
  if (!url)
    return {
      error: `no k7 URL — add { "k7": { "url": "…" } } to ${WORKSPACE_SETTINGS} at the workspace root (or set K7_URL)`,
    };
  if (!token)
    return {
      error: `no k7 token — add { "k7": { "token": "…" } } to ${WORKSPACE_SETTINGS} at the workspace root (generate one in k7 Settings)`,
    };
  return { url, token };
}

// The song's stable id for k7, generating + persisting one into project.yaml if absent.
function ensureSongUuid(songDir: string, existing?: string): string {
  if (existing) return existing;
  const uuid = randomUUID();
  // The field is created whether or not `project:` exists, so there is no missing-block failure.
  setFileValue(join(songDir, "project.yaml"), ["project", "uuid"], uuid);
  return uuid;
}

export interface K7Result {
  created: boolean;
  releaseId: string;
  title: string;
  stems: number;
}

// Publish to k7; an unknown song throws NEEDS_META so the caller can prompt for artist/title.
export const NEEDS_META = "NEEDS_META";

export async function shareToK7(
  render: Renderer,
  songDir: string,
  cfg: K7Config,
  opts: { artist?: string; title?: string; noStems?: boolean } = {},
): Promise<K7Result> {
  if (!existsSync(join(songDir, "project.yaml")))
    throw new Error(
      "k7 needs a folder project (a directory with project.yaml)",
    );

  const doc = loadProject(songDir);
  const uuid = ensureSongUuid(songDir, doc.uuid);

  const auth = { Authorization: `Bearer ${cfg.token}` };
  // Does k7 already know this song? A 404 means it's new and needs artist/title.
  const lookup = await fetch(
    `${cfg.url}/api/releases/by-song/${encodeURIComponent(uuid)}`,
    { headers: auth },
  );
  const create = lookup.status === 404;
  if (!create && !lookup.ok)
    throw new Error(
      `k7 lookup failed: ${lookup.status} ${await lookup.text()}`,
    );
  if (create && !opts.artist) {
    const e = new Error(NEEDS_META);
    (e as Error & { defaultTitle?: string }).defaultTitle = doc.name;
    throw e;
  }

  const tmp = mkdtempSync(join(tmpdir(), "tbexport-"));
  try {
    const manifest = await render(doc, tmp, { stems: !opts.noStems });

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
