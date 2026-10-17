// compile/jsDspChild.ts — the program the jailed node child runs, sent on its stdin: it locks the process
// down, then imports @studio/dsp and the module's source as data: URLs and prints the graph as JSON — an
// empty one for a source with no default export, so its node keeps its place in the chain.
// What a reader gets wrong: the lock-down runs BEFORE the module is imported, so the module sees no import,
// no fetch and no process escape hatch at all — docs/jsdspJail.md.

/** What the child deletes from `process`: each one reaches outside the process or swaps its code. */
const PROCESS_HOLES = [
  "binding",
  "_linkedBinding",
  "dlopen",
  "getBuiltinModule",
  "kill",
  "_kill",
  "_debugProcess",
  "execve",
  "loadEnvFile",
  "report",
  "chdir",
  "setuid",
  "setgid",
  "seteuid",
  "setegid",
  "setgroups",
  "initgroups",
];

/** The network the permission model of node 24 leaves open, as globals. */
const GLOBAL_HOLES = ["fetch", "WebSocket", "EventSource"];

/** The child's source, with the two module URLs it alone may import. */
export function jsDspChild(dspUrl: string, moduleUrl: string): string {
  return `import { registerHooks } from "node:module";
const DSP = ${JSON.stringify(dspUrl)};
const MODULE = ${JSON.stringify(moduleUrl)};
registerHooks({
  resolve(specifier, context, next) {
    const url = specifier === "@studio/dsp" ? DSP : specifier;
    if (url !== DSP && url !== MODULE) throw new Error("jsdsp: import refused: " + specifier);
    return next(url, context);
  },
});
for (const k of ${JSON.stringify(PROCESS_HOLES)}) {
  try { delete process[k]; } catch {}
  if (process[k] !== undefined) Object.defineProperty(process, k, { value: undefined });
}
for (const k of ${JSON.stringify(GLOBAL_HOLES)}) delete globalThis[k];
const out = process.stdout;
const { graph } = await import(DSP);
const d = (await import(MODULE)).default ?? {};
out.write(JSON.stringify(typeof d === "function" ? graph(d) : d, null, 2));
`;
}
