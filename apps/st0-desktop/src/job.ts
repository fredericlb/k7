// job.ts — a Windows Job Object with kill-on-close, so a force-killed or crashed app can't
// orphan the engine and file service holding their ports. Membership is INHERITED, which is
// why init() must run before anything spawns and why putting THIS process in covers the
// engine and the file service for free — the supervisor runs in here now. A no-op off
// Windows, where the closing stdin pipe plays the same role. See docs/lifetime.md.

import type { ChildProcess } from "node:child_process";
import { line } from "./logbus.ts";

declare function require(id: string): unknown;

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JobObjectExtendedLimitInformation = 9;
// PROCESS_TERMINATE | PROCESS_SET_QUOTA — the two rights AssignProcessToJobObject needs.
const PROCESS_ACCESS = 0x0001 | 0x0100;

interface Kernel32 {
  CreateJobObjectW: (attrs: null, name: null) => unknown;
  SetInformationJobObject: (
    job: unknown,
    cls: number,
    info: unknown,
    len: number,
  ) => number;
  AssignProcessToJobObject: (job: unknown, proc: unknown) => number;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  CloseHandle: (h: unknown) => number;
}

let k32: Kernel32 | null = null;
// The job handle. NEVER closed: closing it is exactly what triggers the kill, and the OS
// doing so at process exit is the mechanism we rely on.
let job: unknown = null;
let ready = false;

/**
 * Create the kill-on-close job once, at startup, BEFORE anything is spawned. A failure only
 * leaves the safety net off and is never fatal — but it is logged, because reduced coverage
 * that nobody can see is the same as coverage nobody has.
 */
export function init(): void {
  if (ready) return;
  ready = true;
  if (process.platform !== "win32") return;

  try {
    // Required lazily: koffi is an optionalDependency, present on Windows only.
    const koffi = require("koffi") as typeof import("koffi");
    const lib = koffi.load("kernel32.dll");

    const BASIC = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
      PerProcessUserTimeLimit: "int64_t",
      PerJobUserTimeLimit: "int64_t",
      LimitFlags: "uint32_t",
      MinimumWorkingSetSize: "size_t",
      MaximumWorkingSetSize: "size_t",
      ActiveProcessLimit: "uint32_t",
      Affinity: "uintptr_t",
      PriorityClass: "uint32_t",
      SchedulingClass: "uint32_t",
    });
    const EXTENDED = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
      BasicLimitInformation: BASIC,
      IoInfo: koffi.array("uint64_t", 6),
      ProcessMemoryLimit: "size_t",
      JobMemoryLimit: "size_t",
      PeakProcessMemoryUsed: "size_t",
      PeakJobMemoryUsed: "size_t",
    });

    k32 = {
      CreateJobObjectW: lib.func("void *CreateJobObjectW(void *, void *)"),
      SetInformationJobObject: lib.func(
        "int SetInformationJobObject(void *, int, void *, uint32_t)",
      ),
      AssignProcessToJobObject: lib.func(
        "int AssignProcessToJobObject(void *, void *)",
      ),
      OpenProcess: lib.func("void *OpenProcess(uint32_t, bool, uint32_t)"),
      CloseHandle: lib.func("int CloseHandle(void *)"),
    } as Kernel32;

    const handle = k32.CreateJobObjectW(null, null);
    if (!handle) throw new Error("CreateJobObjectW returned null");

    const info = Buffer.alloc(koffi.sizeof(EXTENDED));
    koffi.encode(info, EXTENDED, {
      BasicLimitInformation: { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE },
    });
    if (
      !k32.SetInformationJobObject(
        handle,
        JobObjectExtendedLimitInformation,
        info,
        info.length,
      )
    ) {
      throw new Error("SetInformationJobObject failed");
    }
    job = handle;
  } catch (e) {
    job = null;
    line(
      "host",
      `no kill-on-close job (${String(e)}) — force-kill will orphan`,
    );
  }
}

/**
 * Put a freshly-spawned child — and everything it later spawns — under the job. A no-op when
 * there is no job or the assign fails (an app already inside a job that forbids nesting, which
 * some CI agents and MDM setups do); the child then falls back to the graceful quit path.
 */
export function assign(child: ChildProcess): void {
  if (child.pid === undefined) return;
  assignPid(child.pid);
}

/** Put THIS process in, so all it spawns inherits — the supervisor is no longer a child to assign. */
export function assignSelf(): void {
  assignPid(process.pid);
}

function assignPid(pid: number): void {
  if (!job || !k32) {
    // Silence here is what "the safety net is off" used to look like from the outside.
    if (process.platform === "win32")
      line("host", `no job to put pid ${pid} in — a force-kill will orphan`);
    return;
  }
  const proc = k32.OpenProcess(PROCESS_ACCESS, false, pid);
  if (!proc) {
    line("host", `could not open pid ${pid} to put it in the job`);
    return;
  }
  try {
    if (!k32.AssignProcessToJobObject(job, proc)) {
      line(
        "host",
        "no kill-on-close job (nested job?) — force-kill will orphan",
      );
    }
  } finally {
    // Our handle to the CHILD, not to the job — the job's is what must stay open.
    k32.CloseHandle(proc);
  }
}
