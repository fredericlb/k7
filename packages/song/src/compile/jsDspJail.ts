// compile/jsDspJail.ts — a module's jsdsp source run in a jail: transpiled HERE with esbuild, then run by a
// node child with an empty environment, the permission model on with nothing granted, every import refused,
// and as another OS user when the host has one. What a reader gets wrong: Node's permission model is a seat
// belt, not a sandbox — the separate user is what still holds if it gives way. docs/jsdspJail.md.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname } from "node:path";
import { jsDspChild } from "./jsDspChild";

export const JSDSP_TIMEOUT_MS = 30_000;
/** The largest graph a child may print; the biggest real one is a few kB. */
export const JSDSP_MAX_OUTPUT = 1 << 20;
const JSDSP_HEAP_MB = 256;
/** The user a root process drops a child to when `STUDIO_DSP_UID` names none: `nobody`. */
const NOBODY = 65534;

const req = createRequire(import.meta.url);
type Esbuild = typeof import("esbuild");
let esbuild: Esbuild | undefined;
let dspUrl: string | undefined;

const esb = (): Esbuild => {
  esbuild ??= req("esbuild") as Esbuild;
  return esbuild;
};

const dataUrl = (js: string): string =>
  `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`;

// @studio/dsp as ONE module, bundled once per process: it is our code, so its imports resolve freely.
function dspLibrary(): string {
  if (dspUrl) return dspUrl;
  const out = esb().buildSync({
    entryPoints: [req.resolve("@studio/dsp")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  dspUrl = dataUrl(out.outputFiles[0]?.text ?? "");
  return dspUrl;
}

const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts",
  ".mts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
};

// A transform, never a bundle: resolving the module's imports here would read files with THIS process's rights.
function moduleUrl(text: string, name: string): string {
  const { code } = esb().transformSync(text, {
    loader: LOADERS[extname(name)] ?? "js",
    format: "esm",
    sourcefile: name,
    logLevel: "silent",
  });
  return dataUrl(code);
}

interface Jail {
  cmd: string;
  uid?: number;
  gid?: number;
}

/** Who runs the child: the image's setuid helper, a uid a root process drops to, or this user on a desktop. */
export function jailUser(env: NodeJS.ProcessEnv = process.env): Jail {
  if (env.STUDIO_DSP_EXEC) return { cmd: env.STUDIO_DSP_EXEC };
  if (process.getuid?.() !== 0) return { cmd: process.execPath };
  const uid = Number(env.STUDIO_DSP_UID ?? NOBODY);
  const gid = Number(env.STUDIO_DSP_GID ?? uid);
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0)
    throw new Error("jsdsp: refusing to run a module as root");
  return { cmd: process.execPath, uid, gid };
}

/** Nothing inherited: only what the node binary itself needs to start on this host. */
function jailEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  if (process.platform === "win32" && process.env.SystemRoot)
    env.SystemRoot = process.env.SystemRoot;
  return env;
}

/** The graph a jsdsp source describes, as the JSON text the child printed; throws on any failure. */
export function runJsDsp(text: string, name: string): string {
  const program = jsDspChild(dspLibrary(), moduleUrl(text, name));
  const { cmd, uid, gid } = jailUser();
  return execFileSync(
    cmd,
    [
      `--max-old-space-size=${JSDSP_HEAP_MB}`,
      "--permission",
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "-",
    ],
    {
      input: program,
      encoding: "utf8",
      env: jailEnv(),
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: JSDSP_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: JSDSP_MAX_OUTPUT,
      windowsHide: true,
      ...(uid === undefined ? {} : { uid, gid }),
    },
  );
}
