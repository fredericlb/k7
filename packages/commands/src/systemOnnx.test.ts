// `system onnx` — what the bound engine's machine separates on. The setting is the MACHINE's, so
// the verb only ever asks its host; a host with no machine behind it refuses rather than pretending
// a value was kept somewhere.

import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const logs: string[] = [];
const refusals: string[] = [];

/** `held` is the machine's setting; null stands for no engine bound, undefined for no way to ask. */
const host = (held: string[] | null | undefined) => {
  let kept = held;
  return {
    songPath: "",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
    ...(held === undefined
      ? {}
      : {
          onnxProviders: async (set?: readonly string[]) => {
            if (kept === null) return null;
            if (set) kept = [...set];
            return kept;
          },
        }),
    get kept() {
      return kept;
    },
  } as never as { kept: string[] | null };
};

const reset = (): void => {
  logs.length = 0;
  refusals.length = 0;
};

describe("system onnx", () => {
  it("writes the list on the machine, lowercased and in order, and warns about dml", async () => {
    reset();
    const h = host([]);
    await runCommand("system onnx DML,cpu", h as never, "cli");
    expect(h.kept).toEqual(["dml", "cpu"]);
    expect(logs.join(" ")).toMatch(/tries dml, cpu, in that order/);
    expect(logs.join(" ")).toMatch(/HANGS/);
  });

  it("says what the machine holds when asked with no argument", async () => {
    reset();
    await runCommand("system onnx", host(["coreml", "cpu"]) as never, "cli");
    expect(refusals.join(" ")).toMatch(/currently: coreml, cpu/);
  });

  it('clears it with ""', async () => {
    reset();
    const h = host(["dml"]);
    await runCommand('system onnx ""', h as never, "cli");
    expect(h.kept).toEqual([]);
    expect(logs.join(" ")).toMatch(/back to the CPU/);
  });

  it("refuses an unknown provider without touching the machine", async () => {
    reset();
    const h = host(["cpu"]);
    await runCommand("system onnx tpu", h as never, "cli");
    expect(h.kept).toEqual(["cpu"]);
    expect(refusals.join(" ")).toMatch(/unknown execution provider\(s\): tpu/);
  });

  it("refuses with no engine bound, and with no way to reach one", async () => {
    reset();
    await runCommand("system onnx cpu", host(null) as never, "cli");
    await runCommand("system onnx cpu", host(undefined) as never, "cli");
    expect(refusals.filter((l) => /no engine is chosen/.test(l))).toHaveLength(
      2,
    );
  });
});
