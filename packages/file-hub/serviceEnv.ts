// serviceEnv.ts — the environment an account's file service starts with: an ALLOW-list taken from the hub's.
// What a reader gets wrong: a variable the file service (or a program it runs) starts reading must be added
// HERE, or it is silently unset there — and the backend's secrets stay out on purpose. docs/fileHub.md.

/** What the OS and the programs a file service runs (node, ffmpeg, chromium, the engine, esbuild) need. */
const SYSTEM = [
  "PATH",
  "Path",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  // Where node keeps the bytecode of the bundle it compiled, so a restart skips the parse (docs/fileHub.md).
  "NODE_COMPILE_CACHE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ELECTRON_RUN_AS_NODE",
  "ESBUILD_BINARY_PATH",
  "PREFIX",
  "LD_LIBRARY_PATH",
  "ANDROID_ROOT",
  "ANDROID_DATA",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
];

/** What the file service's code (a sweep of its bundle's inputs) and the engine it runs read; the sync trio and K7_TOKEN are credentials, set per account or not at all. */
const STUDIO = [
  "STUDIO_CHROMIUM",
  "STUDIO_DEMOS",
  "STUDIO_DSP_EXEC",
  "STUDIO_DSP_UID",
  "STUDIO_DSP_GID",
  "STUDIO_ENGINE",
  "STUDIO_ENGINE_ROOTS",
  "STUDIO_FAUST_LIBS",
  "STUDIO_HUB_URL",
  "STUDIO_LIBRARIES_HOME",
  "STUDIO_LIVE_SYNC",
  "STUDIO_MEDIATEK",
  "STUDIO_MODELS",
  "STUDIO_PARSE_CACHE",
  "STUDIO_RENDER_DEBUG",
  "STUDIO_RENDER_JOBS_URL",
  "STUDIO_RENDER_TRACE",
  "STUDIO_WHISPER_MODEL",
  "FFMPEG_BIN",
  "FFPROBE_BIN",
  "DIRT_SAMPLES",
  "STRUDEL_SAMPLES",
  "K7_URL",
];

const PREFIXES = ["LC_", "XDG_", "TERMUX_", "PLAYWRIGHT_"];
const ALLOWED = new Set([...SYSTEM, ...STUDIO]);

/** The subset of `from` a file service may see. */
export function serviceEnv(from: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(from))
    if (
      v !== undefined &&
      (ALLOWED.has(k) || PREFIXES.some((p) => k.startsWith(p)))
    )
      env[k] = v;
  return env;
}
