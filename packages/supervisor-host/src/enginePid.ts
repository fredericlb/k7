// enginePid.ts — the supervisor's `engine.pid` read as an IDENTITY before anything is killed: the pid,
// its start time and its executable, the format engine/k7-supervisor/src/PidFile.h writes. A bare pid
// still reads, unverified, and is never killed: the OS may have handed that number to anything since.

import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";

export interface PidRecord {
  pid: number;
  /** As the OS spells it: macOS seconds since the epoch, Linux /proc stat field 22, Windows creation FILETIME. */
  start?: string;
  exe?: string;
}

export type PidCheck = "same" | "unverified" | "stale";

/** Either format; `null` when the first line is not a pid. */
export function parsePidFile(text: string): PidRecord | null {
  const [first, ...rest] = text.split(/\r?\n/);
  const head = first?.trim() ?? "";
  if (!/^\d{1,9}$/.test(head)) return null;
  const pid = Number(head);
  if (pid <= 0) return null;
  const rec: PidRecord = { pid };
  for (const raw of rest) {
    const l = raw.trim();
    if (l.startsWith("start=") && /^\d{1,20}$/.test(l.slice(6)))
      rec.start = l.slice(6);
    else if (l.startsWith("exe=")) rec.exe = l.slice(4);
  }
  return rec;
}

export function isEngineExecutable(exe: string): boolean {
  const name = basename(exe.replaceAll("\\", "/")).toLowerCase();
  return name === "k7-runtime" || name === "k7-runtime.exe";
}

/** The same verdict as PidFile.cpp's `check`: only `same` may be killed. */
export function checkPid(
  recorded: PidRecord,
  live: PidRecord | null,
  alive: boolean,
): PidCheck {
  if (recorded.pid <= 0 || !alive) return "stale";
  if (!live?.start || !live.exe) return "unverified";
  if (!isEngineExecutable(live.exe)) return "stale";
  if (!recorded.start) return "unverified";
  return recorded.start === live.start ? "same" : "stale";
}

const MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";

/** `ps -o lstart=` in the C locale, as local seconds since the epoch: what proc_pidinfo's pbi_start_tvsec holds. */
export function lstartSeconds(text: string): string | undefined {
  const m =
    /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(
      text.trim(),
    );
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1] ?? "");
  if (month < 0 || month % 3) return undefined;
  const at = new Date(
    Number(m[6]),
    month / 3,
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  return String(Math.floor(at.getTime() / 1000));
}

function run(bin: string, args: string[]): string {
  return execFileSync(bin, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    timeout: 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function systemRoot(): string {
  return process.env.SystemRoot ?? "C:\\Windows";
}

/** What the OS says of a live `pid` now; `null` when it is gone or will not say. */
export function inspectPid(pid: number): PidRecord | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const start = stat
        .slice(stat.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/)[19];
      const exe = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "");
      return { pid, start, exe };
    }
    if (process.platform === "darwin") {
      const start = lstartSeconds(
        run("/bin/ps", ["-o", "lstart=", "-p", String(pid)]),
      );
      const exe = run("/bin/ps", ["-o", "comm=", "-p", String(pid)]).trim();
      return start ? { pid, start, exe } : null;
    }
    if (process.platform === "win32") {
      const ps = join(
        systemRoot(),
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToFileTimeUtc(); $p.Path`;
      const [start, exe] = run(ps, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]).split(/\r?\n/);
      return start && exe
        ? { pid, start: start.trim(), exe: exe.trim() }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists and belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The engine's whole tree: its process group on POSIX, taskkill by its System32 path on Windows. */
export function killTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execFileSync(
        join(systemRoot(), "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
    } catch {
      /* already gone */
    }
    return;
  }
  // The group only when the pid leads it: a negative pid names whichever group bears that number.
  if (leadsGroup(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      /* fall through to the pid alone */
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function leadsGroup(pid: number): boolean {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return (
        stat
          .slice(stat.lastIndexOf(")") + 1)
          .trim()
          .split(/\s+/)[2] === String(pid)
      );
    }
    return (
      run("/bin/ps", ["-o", "pgid=", "-p", String(pid)]).trim() === String(pid)
    );
  } catch {
    return false;
  }
}
