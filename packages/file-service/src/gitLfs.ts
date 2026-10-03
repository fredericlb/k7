// gitLfs.ts — the LFS half of a workspace's repository: what it tracks, the repo-local filter
// without which git would not know about LFS at all here, and the proof that the media actually
// ARRIVED. A song IS its audio, and plain git keeps a whole new copy of every wav on every
// edit — see docs/workspaces.md.

import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { AUDIO_EXT, VIDEO_EXT } from "@studio/mediatek/media";

const run = promisify(execFile);

/** How long the fetch may say NOTHING before it is presumed stuck — never how long it may take.
 *  A total cap cut off any repository whose media was larger than the link was fast, which for a
 *  song repository is the ordinary case rather than the exception. See docs/workspaces.md. */
const FETCH_IDLE_MS = 120_000;
const QUICK_MS = 10_000;
/** A `GIT_TRACE` line: `12:34:56.789012 trace git-lfs: …`, or git's own `… git.c:…`. */
const TRACE_LINE = /^\d{2}:\d{2}:\d{2}\.\d+ /;

const ATTR = "filter=lfs diff=lfs merge=lfs -text";

/** `*.[Ww][Aa][Vv]`: git matches an attribute pattern case-sensitively, and a library hands over `.FLAC`. */
function anyCase(ext: string): string {
  const body = [...ext.slice(1)]
    .map((c) => (c.toUpperCase() === c ? c : `[${c.toUpperCase()}${c}]`))
    .join("");
  return `*.${body}`;
}

/** What a workspace this service makes puts through LFS — every media extension the library knows. */
export const GITATTRIBUTES: string = [
  "# Media through git LFS — see packages/file-service/docs/workspaces.md",
  ...[...new Set([...AUDIO_EXT, ...VIDEO_EXT])]
    .sort()
    .map((ext) => `${anyCase(ext)} ${ATTR}`),
  "",
].join("\n");

// One probe for the process' life: this is asked once per created or cloned workspace.
let probe: Promise<boolean> | null = null;

/** Is git-lfs on this machine at all? Everything below turns on the answer. */
export function lfsAvailable(): Promise<boolean> {
  probe ??= run("git", ["lfs", "version"], { timeout: QUICK_MS }).then(
    () => true,
    () => false,
  );
  return probe;
}

/**
 * Point THIS repository's filters at git-lfs. `--local` rather than the machine's own install:
 * `gitEnvFor` pins `GIT_CONFIG_GLOBAL` to /dev/null, so nothing global is visible — docs/workspaces.md.
 */
async function installLfs(root: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run("git", ["lfs", "install", "--local"], {
    cwd: root,
    env,
    timeout: QUICK_MS,
  });
}

/** Write the LFS rules and install the filter — see docs/workspaces.md for what a machine without git-lfs gets. */
export async function setUpLfs(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  writeFileSync(join(root, ".gitattributes"), GITATTRIBUTES, "utf8");
  if (!(await lfsAvailable())) {
    console.warn(
      `[workspaces] no git-lfs on this machine: ${root} versions its audio as ordinary git blobs — https://git-lfs.com`,
    );
    return;
  }
  await installLfs(root, env);
}

/** Does anything in this checkout route through LFS? Its own `.gitattributes` files are what say so. */
async function usesLfs(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    // Every .gitattributes in the tree, not just the root one: a repository may declare LFS per folder.
    await run(
      "git",
      ["grep", "-l", "-F", "filter=lfs", "HEAD", "--", "*.gitattributes"],
      { cwd: root, env, timeout: QUICK_MS },
    );
    return true;
  } catch {
    return false; // no match, or an unborn HEAD — both are "nothing through LFS"
  }
}

/** The first line of every LFS pointer, from git-lfs's own spec — see docs/workspaces.md for why nothing else tells. */
const POINTER_MAGIC = "version https://git-lfs.github.com/spec/v1";

/** How long the verification may take. Longer than QUICK_MS: `ls-files` walks the whole of HEAD. */
const VERIFY_MS = 60_000;

/** Set while the media is owed, so a fetch that never returns at all is still known about later. */
const pendingPath = (root: string) => join(root, ".git", "studio-lfs-pending");

/** Is this file still the pointer text git checked out, rather than the bytes it stands for? */
export function isPointer(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(POINTER_MAGIC.length);
    const read = readSync(fd, buf, 0, buf.length, 0);
    return read === buf.length && buf.toString("utf8") === POINTER_MAGIC;
  } catch {
    return false; // gone or unreadable — a real problem, but not the one this asks about
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Which of the repository's LFS paths are STILL pointers — the question git itself cannot answer. */
async function pointersLeft(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { stdout } = await run("git", ["lfs", "ls-files", "--name-only"], {
    cwd: root,
    env,
    timeout: VERIFY_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => isPointer(join(root, p)));
}

/**
 * Does this workspace still owe its media? Cheap when it does not — one `existsSync` — and it
 * CLEARS a marker whose media has since arrived, so fetching by hand is a supported way out.
 */
export async function lfsPending(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (!existsSync(pendingPath(root))) return false;
  if (!(await lfsAvailable())) return true;
  if ((await pointersLeft(root, env)).length) return true;
  rmSync(pendingPath(root), { force: true });
  return false;
}

/** Thrown when the fetch ended and the media is still pointer text — see docs/workspaces.md. */
export class IncompleteLfsError extends Error {
  constructor(root: string, left: number) {
    super(
      `${left} of this workspace's media files are still git LFS pointers rather than audio: ` +
        `the fetch did not finish. Run \`git lfs pull\` in ${root} to resume it.`,
    );
    this.name = "IncompleteLfsError";
  }
}

/** Thrown when a clone's media can only arrive as pointer text — the sentence names the fix. */
export class NoLfsError extends Error {
  constructor(uri: string) {
    super(
      `${uri} stores its media with git LFS, and git-lfs is not installed on this machine. ` +
        `Install it from https://git-lfs.com, then import the repository again.`,
    );
    this.name = "NoLfsError";
  }
}

/** Turn a fresh clone's pointers back into bytes — a clone here fetches none on its own (docs/workspaces.md). */
export async function pullLfs(
  root: string,
  uri: string,
  env: NodeJS.ProcessEnv,
  onLine?: (line: string) => void,
): Promise<void> {
  if (!(await lfsAvailable())) {
    if (!(await usesLfs(root, env))) return;
    // Marked as well as thrown: the workspace stands, and what it is missing outlives this call.
    writeFileSync(pendingPath(root), "", "utf8");
    throw new NoLfsError(uri);
  }
  await installLfs(root, env);
  // BEFORE the fetch, so a pull that is killed rather than failed still leaves the state written down.
  writeFileSync(pendingPath(root), "", "utf8");
  onLine?.("LFS: fetching media");
  await lfsPull(root, env, onLine);
  // git exiting 0 is not the proof: a pointer left in the tree matches HEAD, so git calls it clean.
  const left = await pointersLeft(root, env);
  if (left.length) throw new IncompleteLfsError(root, left.length);
  rmSync(pendingPath(root), { force: true });
}

/**
 * `git lfs pull`, bounded by SILENCE. `execFile`'s `timeout` is a total cap and reports nothing
 * on the way, so this spawns instead and resets the clock on every line — the same rule
 * `gitClone` follows, and for the same repository.
 */
function lfsPull(
  root: string,
  env: NodeJS.ProcessEnv,
  onLine?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // git-lfs draws its meter only for a terminal; piped, it says nothing at all and every
    // fetch would look stuck to the timer below.
    const child = spawn("git", ["lfs", "pull"], {
      cwd: root,
      // GIT_TRACE: what it was doing when it went quiet — the ssh handshake, the batch request — is the only diagnosis a silent kill leaves.
      env: { ...env, GIT_LFS_FORCE_PROGRESS: "1", GIT_TRACE: "1" },
      // No stdin: nothing here can answer a prompt, so a prompt must fail rather than wait for the timer.
      stdio: ["ignore", "pipe", "pipe"],
    });
    const said: string[] = [];
    const traced: string[] = [];
    let silenced = false;
    const stop = () => {
      silenced = true;
      child.kill();
    };
    let timer = setTimeout(stop, FETCH_IDLE_MS);
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(stop, FETCH_IDLE_MS);
    };
    const listen = (stream: NodeJS.ReadableStream) => {
      let tail = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        // \r as well as \n: the meter is rewritten in place rather than emitted line by line.
        const parts = (tail + chunk).split(/\r\n|[\r\n]/);
        tail = parts.pop() ?? "";
        for (const line of parts) {
          const text = line.trim();
          if (!text) continue;
          // A trace line is kept for a silent stop only: it is not progress, and must not hold the timer off.
          const into = TRACE_LINE.test(text) ? traced : said;
          into.push(text);
          if (into.length > 200) into.shift();
          if (into === traced) continue;
          alive();
          onLine?.(text);
        }
      });
    };
    // stdout drained as well: a full pipe blocks git-lfs, which then looks exactly like a stall.
    listen(child.stdout);
    listen(child.stderr);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // Quiet, the trace is the only account of where it stopped; otherwise git-lfs's own words say it.
      const last = (silenced ? traced.slice(-12) : said).join("\n").trim();
      const why = silenced
        ? `git lfs pull said nothing for ${FETCH_IDLE_MS / 1000} s and was stopped`
        : `git lfs pull failed (${code ?? signal})`;
      // git-lfs's own words: "batch response: Repository or object not found" is the answer.
      reject(new Error(last ? `${why}:\n${last}` : why));
    });
  });
}
