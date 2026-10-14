// migrateRacks.ts — move every rack's sounds into a LIBRARY's samples/ and its kit into the NODES.
//
//   STUDIO_HOME=<home> npx tsx packages/song/scripts/migrateRacks.ts <workspace> [--library k7] [--write]
//
// A tap is a note and a library sample, written on the node (docs/racks.md). A `samples` rack's
// clips are moved as they are; a `slice` rack's windows are CUT into one file per sound, byte for
// byte. A module nobody uses keeps its kit, converted in place, so nothing is lost. Dry by default.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { isMap, parseDocument } from "yaml";
import { libraryFamilyRoot } from "../src/sharedFolders";

const args = process.argv.slice(2);
const write = args.includes("--write");
const library =
  args[args.indexOf("--library") + 1] && args.includes("--library")
    ? args[args.indexOf("--library") + 1]
    : "k7";
const workspace = args.find(
  (a, i) => !a.startsWith("--") && args[i - 1] !== "--library",
);
if (!workspace) {
  console.error(
    "usage: migrateRacks <workspace> [--library k7] [--write]   (dry without --write)",
  );
  process.exit(2);
}
const samples = libraryFamilyRoot(library, "samples");
if (!samples) {
  console.error(
    `library '${library}' has no samples/ folder under $STUDIO_HOME — create it first`,
  );
  process.exit(2);
}

const OPTS = { version: "1.2" as const };
type Sym = {
  note?: number;
  clip?: string;
  from?: number;
  to?: number;
  sample?: string;
};

/** Every `module.yaml` under `dir`, with the ref a node names it by. */
function modulesIn(
  dir: string,
  prefix: string,
): { file: string; ref: string }[] {
  const out: { file: string; ref: string }[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "module.yaml")
        out.push({
          file: p,
          ref: `${prefix}/${relative(dir, join(p, "..")).split(sep).join("/")}`,
        });
    }
  };
  walk(dir);
  return out;
}

/** The projects in the workspace: every folder holding a project.yaml. */
const projects = readdirSync(workspace, { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith("_") &&
      existsSync(join(workspace, e.name, "project.yaml")),
  )
  .map((e) => join(workspace, e.name));

/** Where a rack's `clip`/`source` file is: `sources/`, then `assets/`, then beside module.yaml. */
function audioOf(folder: string, name: string): string | null {
  if (isAbsolute(name)) return existsSync(name) ? name : null;
  for (const p of [
    join(folder, "sources", name),
    join(folder, "assets", name),
    join(folder, name),
  ])
    if (existsSync(p)) return p;
  return null;
}

/** [from, to) seconds of a PCM or float wav, as a wav of the same format — bytes copied, nothing resampled. */
function cutWav(src: string, from: number, to: number, out: string): void {
  const b = readFileSync(src);
  let at = 12;
  let fmt: Buffer | null = null;
  let data: { start: number; size: number } | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = b.subarray(at + 8, at + 8 + size);
    if (id === "data")
      data = { start: at + 8, size: Math.min(size, b.length - at - 8) };
    at += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${src}: not a wav this can cut`);
  const rate = fmt.readUInt32LE(4);
  const align = fmt.readUInt16LE(12);
  const frames = Math.floor(data.size / align);
  const a = Math.max(0, Math.min(frames, Math.round(from * rate)));
  const z = Math.max(a, Math.min(frames, Math.round(to * rate)));
  const body = b.subarray(data.start + a * align, data.start + z * align);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0);
  head.writeUInt32LE(4 + 8 + fmt.length + 8 + body.length, 4);
  head.write("WAVE", 8);
  const fmtHead = Buffer.alloc(8);
  fmtHead.write("fmt ", 0);
  fmtHead.writeUInt32LE(fmt.length, 4);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0);
  dataHead.writeUInt32LE(body.length, 4);
  writeFileSync(out, Buffer.concat([head, fmtHead, fmt, dataHead, body]));
}

/** A folder under the library's samples/ no other kit has taken. */
function shelfFor(name: string): string {
  let dir = name;
  for (
    let i = 2;
    existsSync(join(samples as string, dir)) &&
    readdirSync(join(samples as string, dir)).length;
    i++
  )
    dir = `${name}-${i}`;
  return dir;
}

const report: string[] = [];
const consumed = new Set<string>();

const candidates = [
  ...modulesIn(join(workspace, "_modules"), "@workspace").map((m) => ({
    ...m,
    scope: null as string | null,
  })),
  ...projects.flatMap((p) =>
    modulesIn(join(p, "modules"), "@project").map((m) => ({ ...m, scope: p })),
  ),
];

for (const mod of candidates) {
  const doc = parseDocument(readFileSync(mod.file, "utf8"), OPTS);
  const raw = (doc.toJS() ?? {}) as {
    rack?: {
      rack_type?: string;
      source?: string;
      symbols?: Record<string, Sym>;
    };
  };
  const syms = raw.rack?.symbols;
  if (!syms || !Object.keys(syms).length) continue;
  const folder = join(mod.file, "..");
  const shelf = shelfFor(basename(folder));
  const slice = raw.rack?.rack_type === "slice";
  const source =
    slice && raw.rack?.source ? audioOf(folder, raw.rack.source) : null;

  // The kit as taps: each sound's note, and the sample it becomes in the library.
  const kit: Record<string, { note: number; sample?: string }> = {};
  for (const [sym, s] of Object.entries(syms)) {
    const note = Number(s.note ?? 0);
    if (s.sample) {
      kit[sym] = { note, sample: s.sample };
      continue;
    }
    const from = slice ? source : s.clip ? audioOf(folder, s.clip) : null;
    if (!from) {
      report.push(
        `  ! ${mod.ref} ${sym}: no audio found — kept as a tap with no sample`,
      );
      kit[sym] = { note };
      continue;
    }
    const file = slice ? `${sym}.wav` : basename(from);
    const dest = join(samples, shelf, file);
    if (write) {
      mkdirSync(join(samples, shelf), { recursive: true });
      if (slice) cutWav(from, Number(s.from ?? 0), Number(s.to ?? 0), dest);
      else copyFileSync(from, dest);
    }
    consumed.add(from);
    kit[sym] = { note, sample: `@${library}/${shelf}/${file}` };
  }

  // The nodes that play this module: a workspace module from any project, a project one from its own.
  const users = (mod.scope ? [mod.scope] : projects).flatMap((p) => {
    const nodes = join(p, "nodes");
    if (!existsSync(nodes)) return [];
    return readdirSync(nodes)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => join(nodes, f))
      .filter(
        (f) =>
          (
            parseDocument(readFileSync(f, "utf8"), OPTS).toJS() as {
              extends?: string;
            } | null
          )?.extends === mod.ref,
      );
  });

  const writeKit = (
    target: ReturnType<typeof parseDocument>,
    keepOwn: boolean,
  ) => {
    const own =
      ((target.toJS() ?? {}) as { rack?: { symbols?: Record<string, Sym> } })
        .rack?.symbols ?? {};
    // A note the NODE already overrode stays the node's: that was somebody's choice for this kit.
    const symbols = Object.fromEntries(
      Object.entries(kit).map(([sym, t]) => [
        sym,
        {
          ...t,
          ...(keepOwn && own[sym]?.note != null ? { note: own[sym].note } : {}),
        },
      ]),
    );
    const rack = target.createNode({ symbols });
    // One tap per line, `BD: { note: 36, sample: … }`: a kit is read down, as a drum map is.
    const map = rack.get("symbols");
    if (isMap(map))
      for (const it of map.items) if (isMap(it.value)) it.value.flow = true;
    target.setIn(["rack"], rack);
  };

  if (users.length) {
    for (const u of users) {
      const nd = parseDocument(readFileSync(u, "utf8"), OPTS);
      writeKit(nd, true);
      if (write) writeFileSync(u, nd.toString({ lineWidth: 0 }));
    }
    // The module is the sampler now: it keeps `type: rack`, and the kit is the nodes'.
    doc.deleteIn(["rack"]);
    report.push(
      `${mod.ref}: ${Object.keys(kit).length} taps → ${users.map((u) => relative(workspace, u)).join(", ")} · samples in @${library}/${shelf}/`,
    );
  } else {
    writeKit(doc, false);
    report.push(
      `${mod.ref}: no node uses it — its ${Object.keys(kit).length} taps kept on the module, samples in @${library}/${shelf}/`,
    );
  }
  if (write) writeFileSync(mod.file, doc.toString({ lineWidth: 0 }));
}

// What the module folders no longer need: the audio now in the library, with its waveform sidecar.
if (write)
  for (const f of consumed) {
    rmSync(f, { force: true });
    rmSync(`${f}.cache`, { force: true });
  }

console.log(
  report.length
    ? report.join("\n")
    : "no rack with sounds of its own — nothing to do",
);
console.log(
  write
    ? `\n${consumed.size} audio file(s) moved into the library`
    : "\n(dry run — nothing written; add --write)",
);
if (!statSync(samples).isDirectory()) process.exit(1);
