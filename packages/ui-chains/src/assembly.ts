// assembly.ts — folding a project's assemblies into the built graph: a box instead of its
// members when it is closed, a titled frame around them when it is open. A POST-PASS over
// `buildGraph`'s output, in the family of `alignModuleRank` and `masterRunAside` — the model it
// reads is a drawing fact, so nothing here may change a cable's meaning, only where it lands.
// Full rationale: docs/graphBuild.md, and packages/song/docs/assemblies.md.

import type {
  WebGraph,
  WebModuleUI,
  WebNodeAssembly,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import {
  assemblyId,
  type Jack,
  jacksFor,
  nodeSize,
  type RawEdge,
  type RawNode,
  rackGrid,
} from "./graph";

/** The UI a CLOSED box carries: one knob per promoted param, bound by the name the template gave it. */
export function assemblyUI(
  params: NonNullable<WebNodeAssembly["params"]>,
): WebModuleUI {
  const names = Object.keys(params);
  const { cols, rows } = rackGrid(names.length);
  const widgets: Record<string, WebWidget> = {};
  names.forEach((name, i) => {
    widgets[`asm:${name}`] = {
      type: "knob",
      col: i % cols,
      row: Math.floor(i / cols),
      // The bind is the PROMOTED name; `assemblyOf.params` is what turns it into a member's param.
      bind: name,
      label: name,
    };
  });
  return { cols, rows, widgets };
}

/** A node's own name in the chains file — a member is matched by it, exactly as `jackRef` resolves one. */
const nameOf = (n: RawNode): string | undefined =>
  n.kind === "module" || n.kind === "track" ? (n.module ?? n.label) : undefined;

/** The plug a cable off (or onto) this member leaves by: the one naming the port, else the port-less one. */
function plugFor(
  plugs: readonly { name: string; node: string; port?: string }[],
  node: string,
  port: string | undefined,
): { name: string; port?: string } | undefined {
  const mine = plugs.filter((p) => p.node === node);
  return mine.find((p) => p.port === port) ?? mine.find((p) => !p.port);
}

/** Fold every assembly the graph declares into `built` — see docs/graphBuild.md. */
export function foldAssemblies(
  graph: WebGraph,
  built: { nodes: RawNode[]; edges: RawEdge[] },
  open: ReadonlySet<string> = new Set(),
): { nodes: RawNode[]; edges: RawEdge[] } {
  const declared = Object.entries(graph.assemblies ?? {});
  if (!declared.length) return built;

  const byName = new Map<string, RawNode>();
  const byId = new Map<string, RawNode>();
  for (const n of built.nodes) {
    byId.set(n.id, n);
    const name = nameOf(n);
    if (name && !byName.has(name)) byName.set(name, n);
  }

  // Which box each member node id belongs to, and the box card each one gets.
  const boxOf = new Map<string, string>();
  const boxes: RawNode[] = [];
  for (const [id, a] of declared) {
    const members = a.members.flatMap((m) => byName.get(m) ?? []);
    // A box whose members are all absent is a box about nothing — the diagnostics already said so.
    if (!members.length) continue;
    const isOpen = open.has(id);
    for (const m of members) boxOf.set(m.id, id);
    const plugs: NonNullable<RawNode["assemblyOf"]>["plugs"] = {};
    for (const p of [...(a.inputs ?? []), ...(a.outputs ?? [])])
      plugs[p.name] = { node: p.node, ...(p.port ? { port: p.port } : {}) };
    // A CLOSED box wears the plugs and the promoted knobs; an OPEN one is a frame and wears neither,
    // because its members are showing their own sockets and the cable lands on the real one.
    const ui =
      !isOpen && a.params && Object.keys(a.params).length
        ? assemblyUI(a.params)
        : undefined;
    boxes.push({
      id: assemblyId(id),
      label: a.label,
      kind: "assembly",
      // The INSTANCE's name, so a pin and `graph move` address the box and not the template's label.
      module: id,
      dim: false,
      missing: !!a.missing,
      stub: false,
      notSupported: false,
      unknownPlugin: false,
      hasNativePluginUI: false,
      ...(isOpen
        ? {}
        : {
            inputs: (a.inputs ?? []).map((p) => plugPort(p)),
            outputs: (a.outputs ?? []).map((p) => plugPort(p)),
          }),
      ...(ui ? { ui } : {}),
      ...nodeSize(ui),
      assemblyOf: {
        uses: a.uses,
        open: isOpen,
        members: a.members,
        plugs,
        ...(a.params ? { params: a.params } : {}),
        ...(a.missing ? { missing: true } : {}),
      },
      // Where the earliest member stood: the box replaces the whole column, and `pushBelowInputs` corrects it.
      rank: members.reduce<number | undefined>(
        (r, m) => (m.rank == null ? r : Math.min(r ?? m.rank, m.rank)),
        undefined,
      ),
    });
  }
  if (!boxes.length) return built;

  const nodes: RawNode[] = [];
  for (const n of built.nodes) {
    const box = boxOf.get(n.id);
    if (!box) nodes.push(n);
    // An OPEN box keeps its members, tagged so the layout can lay them out inside the frame.
    else if (open.has(box)) nodes.push({ ...n, assembly: box });
  }
  nodes.push(...boxes);

  const edges = new Map<string, RawEdge>();
  for (const e of built.edges) {
    const from = boxOf.get(e.source);
    const to = boxOf.get(e.target);
    // Both ends inside one CLOSED box: the cable is what the box is hiding.
    if (from && to && from === to && !open.has(from)) continue;
    // …and inside an OPEN one it is the box's own wiring, which is what the frame is showing.
    const next =
      from && to && from === to ? { ...e, assembly: from } : { ...e };
    if (from && !open.has(from)) {
      const a = graph.assemblies?.[from];
      const member = byId.get(e.source);
      const plug = plugFor(
        a?.outputs ?? [],
        (member && nameOf(member)) ?? "",
        e.sourcePort,
      );
      next.source = assemblyId(from);
      next.sourcePort = plug?.name;
    }
    if (to && !open.has(to)) {
      const a = graph.assemblies?.[to];
      const member = byId.get(e.target);
      const plug = plugFor(
        a?.inputs ?? [],
        (member && nameOf(member)) ?? "",
        e.targetPort,
      );
      next.target = assemblyId(to);
      next.targetPort = plug?.name;
      // The slot is a rank among the bare cables reaching the OLD target; the box redraws its own.
      next.targetSlot = undefined;
    }
    // Two members feeding one thing collapse to ONE cable off the box — the same plug, drawn once.
    const key = `${next.source}->${next.target}#${next.sourcePort ?? ""}#${next.targetPort ?? ""}`;
    if (!edges.has(key)) edges.set(key, { ...next, id: key });
  }

  // The boxes' cables moved, so their sockets are a new question — the same last pass buildGraph runs.
  return withSockets(nodes, [...edges.values()]);
}

/** A plug as a PORT list entry — what `jacksFor` reads; the member it stands for stays on `plugs`. */
const plugPort = (p: {
  name: string;
  type: WebSignal;
  mandatory?: boolean;
}): { name: string; type: WebSignal; mandatory?: boolean } => ({
  name: p.name,
  type: p.type,
  ...(p.mandatory === false ? { mandatory: false } : {}),
});

/** Re-run the socket pass over the boxes alone: their cables moved, so their jacks are a new question. */
function withSockets(
  nodes: RawNode[],
  edges: RawEdge[],
): { nodes: RawNode[]; edges: RawEdge[] } {
  const fed = new Map<string, Set<string>>();
  const left = new Map<string, Set<string>>();
  const bare = new Map<string, number>();
  const arriving = new Map<string, WebSignal>();
  const leaving = new Map<string, WebSignal | undefined>();
  const into = (m: Map<string, Set<string>>, id: string, port: string) => {
    const at = m.get(id) ?? new Set<string>();
    at.add(port);
    m.set(id, at);
  };
  for (const e of edges) {
    if (e.automation) continue;
    into(fed, e.target, e.targetPort ?? "");
    if (!e.targetPort) {
      e.targetSlot = bare.get(e.target) ?? 0;
      bare.set(e.target, e.targetSlot + 1);
    }
    into(left, e.source, e.sourcePort ?? "");
    if (e.signal && !arriving.has(e.target)) arriving.set(e.target, e.signal);
    if (!leaving.has(e.source)) leaving.set(e.source, e.signal);
  }
  const NONE: ReadonlySet<string> = new Set();
  for (const n of nodes) {
    if (n.kind !== "assembly") continue;
    // An OPEN box is a frame: nothing plugs into it, because its members are showing the real sockets.
    if (n.assemblyOf?.open) {
      n.jacks = { in: [], out: [] };
      continue;
    }
    // A box's sockets are its PLUGS and nothing else: no fallback to "the one port every module
    // has", because a template that declares none has said the box takes none. A turntable is a
    // source, and an input jack on one is a hole nothing can be plugged into.
    const jacks = (
      ports: RawNode["inputs"],
      taken: ReadonlySet<string>,
      fallback: WebSignal | undefined,
      grow: boolean,
      count = 0,
    ): Jack[] =>
      ports?.length
        ? jacksFor(ports, taken, fallback, grow, false, undefined, count)
        : [];
    n.jacks = {
      in: jacks(
        n.inputs,
        fed.get(n.id) ?? NONE,
        arriving.get(n.id),
        true,
        bare.get(n.id) ?? 0,
      ),
      out: jacks(n.outputs, left.get(n.id) ?? NONE, leaving.get(n.id), false),
    };
  }
  return { nodes, edges };
}
