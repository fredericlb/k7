// A jsdsp source is code from an account, run on the server: these pin that it gets no secret, no file, no
// process and no network, and that a real module still prints the graph it printed in-process (docs/jsdspJail.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { graph } from "@studio/dsp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDSP_MAX_OUTPUT, jailUser, runJsDsp } from "./compile/jsDspJail";

const here = dirname(fileURLToPath(import.meta.url));
const K7_CORE = join(here, "..", "..", "..", "k7-core");
const SECRET = "jsdsp-test-secret-value";

let ws: string;
beforeAll(() => {
  process.env.JSDSP_TEST_SECRET = SECRET;
  ws = mkdtempSync(join(tmpdir(), "td-jail-"));
  mkdirSync(join(ws, "other"));
  writeFileSync(join(ws, "other", "secret.json"), `{"s":"${SECRET}"}`);
});
afterAll(() => {
  delete process.env.JSDSP_TEST_SECRET;
  rmSync(ws, { recursive: true, force: true });
});

/** What libuv copies from the parent into a Windows child given an environment without them. */
const WINDOWS_CHILD_ENV = [
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
];

const run = (source: string) => runJsDsp(source, join(ws, "mod", "jsdsp.ts"));
const report = (body: string) =>
  JSON.parse(run(body)) as Record<string, unknown>;

describe("a jsdsp source in the jail", () => {
  it("sees an empty environment", () => {
    const r = report("export default { env: { ...process.env } };");
    // macOS itself adds __CF_USER_TEXT_ENCODING to every process it starts.
    const keys = Object.keys(r.env as object).filter(
      (k) => !k.startsWith("__CF_"),
    );
    // On Windows libuv adds these to every child, whatever env it is given (docs/jsdspJail.md).
    const libuv = new Set(WINDOWS_CHILD_ENV.map((k) => k.toUpperCase()));
    expect(
      process.platform === "win32"
        ? keys.filter((k) => !libuv.has(k.toUpperCase()))
        : keys,
    ).toEqual([]);
  });

  it("runs under the permission model with nothing granted", () => {
    const r = report(
      `export default { read: process.permission.has("fs.read"), write: process.permission.has("fs.write"),
        child: process.permission.has("child"), worker: process.permission.has("worker") };`,
    );
    expect(r).toEqual({
      read: false,
      write: false,
      child: false,
      worker: false,
    });
  });

  it.each([
    [
      "a builtin, statically",
      `import { readFileSync } from "node:fs"; export default readFileSync("/etc/passwd", "utf8");`,
    ],
    [
      "a builtin, dynamically",
      `const fs = await import("node:" + "fs"); export default fs.readFileSync("/etc/passwd", "utf8");`,
    ],
    [
      "a file beside the module",
      `import s from "../other/secret.json" with { type: "json" }; export default s;`,
    ],
    [
      "a file by absolute path",
      `const s = await import(${JSON.stringify(`file://${ws}/other/secret.json`)}, { with: { type: "json" } }); export default s.default;`,
    ],
    [
      "child_process",
      `const cp = await import("node:child_process"); export default cp.execSync("id").toString();`,
    ],
    [
      "the network module",
      `const net = await import("node:net"); export default typeof net.connect;`,
    ],
  ])("refuses to import %s", (_what, source) => {
    expect(() => run(source)).toThrow(/import refused/);
  });

  it("finds every escape hatch on process and globalThis closed", () => {
    const r = report(
      `export default { gbm: typeof process.getBuiltinModule, binding: typeof process.binding, kill: typeof process.kill,
        dlopen: typeof process.dlopen, fetch: typeof fetch, ws: typeof WebSocket, require: typeof require };`,
    );
    expect(Object.values(r).every((t) => t === "undefined")).toBe(true);
  });

  it("refuses code generated from strings", () => {
    expect(() => run(`export default eval("1 + 1");`)).toThrow();
  });

  it("caps what it may print", () => {
    const n = JSDSP_MAX_OUTPUT + 1;
    expect(() => run(`export default "x".repeat(${n});`)).toThrow();
  });

  it("never runs as root", () => {
    const j = jailUser({});
    if (process.getuid?.() === 0) expect(j.uid).toBeGreaterThan(0);
    else expect(j.uid).toBeUndefined();
    expect(jailUser({ STUDIO_DSP_EXEC: "/x/dsp-exec" }).cmd).toBe(
      "/x/dsp-exec",
    );
  });
});

const modules = [
  "audio/tremolo/engines/classic",
  "audio/auto-wah",
  "audio/eq/engines/parametric",
  "transformers/note-repeat",
  "cold/normalize",
];

describe("a real module through the jail", () => {
  it.each(modules)("%s prints the graph it builds in-process", async (rel) => {
    const file = join(K7_CORE, "modules", rel, "jsdsp.ts");
    const d = (await import(file)).default;
    const expected = JSON.stringify(
      typeof d === "function" ? graph(d) : d,
      null,
      2,
    );
    const { readFileSync } = await import("node:fs");
    expect(runJsDsp(readFileSync(file, "utf8"), file)).toBe(expected);
  });

  it("still resolves a runtime import of @studio/dsp", () => {
    const out = run(
      `import { graph } from "@studio/dsp"; export default { built: typeof graph };`,
    );
    expect(JSON.parse(out)).toEqual({ built: "function" });
  });
});
