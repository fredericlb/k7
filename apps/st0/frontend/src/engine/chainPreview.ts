// chainPreview.ts — a song played THROUGH a chain: its cached master as the one clip, the
// chain's steps as the plugins on that track. The smallest document that makes the variant
// audible. See ../../docs/chainPreview.md.

import {
  clipDoc,
  emptyDoc,
  enginePlugin,
  pluginDoc,
  readPluginBlock,
  trackDoc,
} from "@studio/engine-protocol/build";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { MediatekEntry } from "@studio/mediatek/types";
import { ENGINE_TOKEN_HEADER, USER_HEADER } from "@studio/web-protocol";

/** The chain a preview lives on. One name, so the engine's diff sees a track it already has
 *  rather than a new one on every play. */
export const PREVIEW_CHAIN = "chain-preview";

/** One step of the chain, resolved far enough to load: its name and what plugin it runs. */
export interface PreviewStep {
  name: string;
  plugin: { type?: unknown; name?: unknown } | undefined;
  enabled?: boolean;
}

/**
 * The headers the engine's file service gates on.
 *
 * Both of them, and the token is not optional in practice: everything past `requireEngineToken`
 * (context.ts) is refused without it as soon as one is configured — which the supervisor always
 * does on a real machine. These two routes used to send the user alone, so they worked on a bare
 * dev run and answered 401 everywhere else. `cacheRoot` swallows that into `null`, which the UI
 * words as "cette machine n'a pas de cache de la médiathèque" — true-sounding, and wrong, which
 * is how it stayed hidden.
 *
 * Omitted when there is no token to send, because a machine with none configured gates on
 * nothing and adding an empty header would fail a comparison that currently passes.
 */
function engineHeaders(
  user: string,
  token?: string | null,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...extra,
    [USER_HEADER]: user,
    ...(token ? { [ENGINE_TOKEN_HEADER]: token } : {}),
  };
}

/**
 * The cache's absolute root on the engine's machine, and the song in it.
 *
 * Two different disks are in play and conflating them is the whole trap: the médiathèque this
 * browser is talking to is HOSTED, while the moteur opens paths on its own machine. What plays
 * is the copy in that machine's cache, reached through its file service — the same route m9
 * takes, for the same reason (see its docs/plumbing.md).
 */
export async function cacheRoot(
  fileBase: string,
  user: string,
  token?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${fileBase}/mediatek`, {
      headers: engineHeaders(user, token),
    });
    if (!res.ok) return null;
    const { present, root } = (await res.json()) as {
      present?: boolean;
      root?: string;
    };
    return present && root ? root : null;
  } catch {
    // Cross-origin refusal, or no file service on that host. Either way there is no path to
    // play, which the button says by staying disabled rather than by failing on click.
    return null;
  }
}

/**
 * Whether that machine's cache actually HOLDS a file, without downloading it.
 *
 * A cache root is not a copy. Only `modules` are pulled automatically (see
 * `packages/file-service/src/mediatekPull.ts`), so a song is on a given machine because
 * something put it there — a mirror, a k7 publish, an analysis — and on a fresh machine it
 * simply is not. The engine would then open nothing and play silence, which is the one
 * failure a transport cannot report: there is no error, just no sound.
 *
 * `Range: bytes=0-0` asks for a single byte, so this costs a request and not a master. A
 * refusal of any kind reads as ABSENT — the caller's next move is the same either way, and
 * treating an unreachable machine as "present" would put the silence back.
 */
export async function cachedOnMachine(
  fileBase: string,
  user: string,
  path: string,
  token?: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${fileBase}/mediatek/file?path=${encodeURIComponent(path)}`,
      { headers: engineHeaders(user, token, { range: "bytes=0-0" }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * A catalogue entry as a file the engine can open, or null.
 *
 * Null is a real state and not an error to swallow: a song is a FOLDER, and one carrying a
 * sidecar but no audio — a mirror that stopped halfway, a folder made by hand — has nothing to
 * play. `meta.master` is the master's filename; its absence IS that state.
 */
export function playablePath(
  root: string,
  entry: MediatekEntry,
): string | null {
  const master = entry.meta?.master;
  if (typeof master !== "string" || !master) return null;
  // The service reports a native root ("C:\…" or "/home/…") while entry paths are POSIX, and
  // the engine takes either — so they are joined with a separator picked from the root rather
  // than normalised into a shape this app has no business choosing.
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root, entry.path, master].join(sep);
}

/** A chain instance's `plugin:` block, from the text of its file. The catalogue says where a
 *  module IS; only the file says what it runs. */
export function stepPlugin(text: string): PreviewStep["plugin"] {
  return readPluginBlock(text);
}

/** What a bounce came back as. `mp3` is false when the machine had no ffmpeg — the render still
 *  happened, in wav, and the caller has to file it under the extension it actually got. */
export interface Bounced {
  bytes: Blob;
  mp3: boolean;
}

/**
 * Bounce a document to audio on the engine's machine.
 *
 * The OFFLINE render (`--render`), not the live transport: it opens no audio device, so it
 * cannot collide with an engine that is playing — which is what makes "process every variant"
 * something you can start while listening to one.
 *
 * `format: mp3` is a REQUEST and not a guarantee. The engine writes wav; the mp3 is an ffmpeg
 * transcode on that machine, best-effort by the same rule the CLI has always used. What comes
 * back says which happened, through its content type, because filing a wav under `.mp3` would
 * produce a library of files that lie about themselves.
 */
export async function bounce(
  fileBase: string,
  user: string,
  doc: ProjectDoc,
  token?: string | null,
): Promise<Bounced> {
  const res = await fetch(`${fileBase}/render`, {
    method: "POST",
    headers: engineHeaders(user, token, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({ doc, format: "mp3" }),
  });
  if (!res.ok) {
    // The route answers `{error}` with a diagnosis — no binary, a bad document, a timeout —
    // and dropping it would leave "render failed" as the only thing anyone ever sees.
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `render ${res.status}`);
  }
  const bytes = await res.blob();
  return {
    bytes,
    mp3: (res.headers.get("content-type") ?? "").includes("mpeg"),
  };
}

/**
 * The document.
 *
 * The plugins are the chain's steps IN ORDER, addressed `chain:module` — the same identity the
 * drawn graph uses. That is the point of it: a graph showing a filter the engine never loaded
 * would be a picture of a signal path that does not exist.
 *
 * `recordDir` stays empty (see emptyDoc): a preview plays and never records, and a made-up
 * directory is one the engine would eventually try to write into.
 */
export function chainPreviewDoc(
  absolutePath: string,
  name: string,
  steps: PreviewStep[],
): ProjectDoc {
  return emptyDoc({
    name: `preview: ${name}`,
    tracks: [
      trackDoc(PREVIEW_CHAIN, {
        name,
        clips: [
          clipDoc({
            id: `${PREVIEW_CHAIN}-clip`,
            type: "audio",
            name,
            source: absolutePath,
          }),
        ],
        plugins: steps.map((s) => {
          const { type, name: pname } = enginePlugin(s.plugin, s.name);
          return pluginDoc({
            id: `${PREVIEW_CHAIN}:${s.name}`,
            type,
            name: pname,
            enabled: s.enabled !== false,
          });
        }),
      }),
    ],
  });
}
