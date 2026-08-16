// The chains graph, rendered from a hand-written WebGraph.
//
// It exists for the PORTS: which sockets a node shows depends on what is wired to it, and that is a rule you
// have to see to judge. The repo's tests cover pure logic and nothing mounts a component (see l8's AGENTS.md),
// so without this the only way to look at a node's sockets was to start the engine, the tray, the file service
// and the editor, and open a song.
//
// The graphs below are the cases the rule is made of, side by side: one input, two with only the flow wired,
// two with both, a module offering more than it uses, and a module with several outputs.

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WebGraph, WebModuleCategory } from "@studio/graph-model";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { useState } from "react";
import { DomChains } from "./DomChains";
import { ModuleIcon, moduleGlyph } from "./moduleIcons";

// A track's glyph is the HOST's vocabulary (l8 draws the same one in its mixer), so the package ships none.
// A coloured dot stands in — enough to see a lane apart from a module.
const icons = {
  ModuleIcon,
  moduleGlyph,
  TrackIcon: ({ color }: { color?: string }) => (
    <span
      style={{
        width: "1em",
        height: "1em",
        borderRadius: 3,
        background: color ?? "#6b7280",
        display: "inline-block",
      }}
    />
  ),
};

const AUDIO = "audio" as const;
const audioCat = "audio" as WebModuleCategory;

/** The crossfade of `@studio/song`'s docs/ports.md: one mandatory input, one optional. */
const CROSSFADE = [
  { name: "a", type: AUDIO },
  { name: "b", type: AUDIO, mandatory: false },
];

const step = (module: string, extra: Record<string, unknown> = {}) => ({
  module,
  category: audioCat,
  emits: AUDIO,
  ...extra,
});

function Graph({ graph }: { graph: WebGraph }) {
  const { nodes, edges } = buildGraph(graph);
  return (
    <div style={{ height: 380, background: "#0d0d0f" }}>
      <DomChains
        icons={icons}
        graph={layout(nodes, edges)}
        selected={null}
        onSelect={() => {}}
        command={() => {}}
      />
    </div>
  );
}

/**
 * A free output and a free input, and a host that ANSWERS — which is what arms the sockets.
 *
 * The crossfade is what makes the bench work at all: every input in a fully wired graph is
 * occupied, so a cable in hand would find nowhere to land and the whole graph would go dark. Fed
 * on `a` only, it offers `b` — one free audio input for the loose end to seek.
 */
function Bench() {
  const [wrote, setWrote] = useState<string[]>([]);
  const graph: WebGraph = {
    chains: {
      gtr: {
        from: "gtr",
        use: [step("crossfade", { inputs: CROSSFADE })],
        out: [{ to: "OUT", gain: 1 }],
      },
      synth: { from: "synth", use: [step("reverb")], out: [] },
    },
    tracks: ["gtr", "synth"],
    warnings: [],
  };
  const { nodes, edges } = buildGraph(graph);
  return (
    <div style={{ height: 380, background: "#0d0d0f" }}>
      <pre data-testid="wrote" style={{ color: "#9ca3af", margin: 0 }}>
        {wrote.join("\n") || "— rien écrit —"}
      </pre>
      <DomChains
        icons={icons}
        graph={layout(nodes, edges)}
        selected={null}
        onSelect={() => {}}
        command={() => {}}
        onConnect={(f, t) => setWrote((w) => [...w, `connect ${f} ${t}`])}
        onDisconnect={(f, t) => setWrote((w) => [...w, `disconnect ${f} ${t}`])}
        onReplug={(f, t, nf, nt) =>
          setWrote((w) => [...w, `replug ${f} ${t} → ${nf} ${nt}`])
        }
      />
    </div>
  );
}

const meta: Meta<typeof Graph> = { title: "chains/Ports", component: Graph };
export default meta;
type Story = StoryObj<typeof Graph>;

/** The overwhelming case: one input, one output, one socket each and neither named. */
export const OneInput: Story = {
  args: {
    graph: {
      chains: {
        gtr: { from: "gtr", use: [step("amp")], out: [{ to: "OUT", gain: 1 }] },
      },
      tracks: ["gtr"],
      warnings: [],
    },
  },
};

/** Two ports, only the flow wired: `a` is occupied, `b` is the free socket offered past it. */
export const SecondInputOffered: Story = {
  args: {
    graph: {
      chains: {
        deckA: {
          from: "deckA",
          use: [step("crossfade", { inputs: CROSSFADE })],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["deckA"],
      warnings: [],
    },
  },
};

/** …and wired, which is engine/capot/songs/crossfade-demo.l8: the cable naming `#b` lands on `b`. */
export const BothInputsWired: Story = {
  args: {
    graph: {
      chains: {
        deckA: {
          from: "deckA",
          use: [step("crossfade", { inputs: CROSSFADE })],
          out: [{ to: "OUT", gain: 1 }],
        },
        deckB: {
          from: "deckB",
          use: [],
          out: [{ to: "crossfade#b", gain: 1 }],
        },
      },
      tracks: ["deckA", "deckB"],
      warnings: [],
    },
  },
};

/** Four optional ports, one used. Only the next one shows — a mixer does not present three empty holes. */
export const MoreThanItUses: Story = {
  args: {
    graph: {
      chains: {
        src: {
          from: "src",
          use: [
            step("summing", {
              inputs: ["a", "b", "c", "d"].map((name, i) => ({
                name,
                type: AUDIO,
                ...(i ? { mandatory: false } : {}),
              })),
            }),
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["src"],
      warnings: [],
    },
  },
};

/** Outputs do not reveal themselves: an output is offered rather than required, so all of them show at once. */
export const SeveralOutputs: Story = {
  args: {
    graph: {
      chains: {
        deck: {
          from: "deck",
          use: [
            step("deck", {
              outputs: [
                { name: "main", type: AUDIO },
                { name: "cue", type: AUDIO },
              ],
            }),
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["deck"],
      warnings: [],
    },
  },
};

/**
 * The one cable that KEEPS its arrowhead.
 *
 * A signal cable ends in a plug and the plug is the socket it disappears into, so a head would be saying
 * something the socket already says. An automation cable does not plug into anything: it leaves the curve's
 * socket like any other, and then lands on a knob in the middle of a card — and a headless line pointing into
 * a widget grid says nothing about which knob it means.
 */
export const Automation: Story = {
  args: {
    graph: {
      chains: {
        gtr: {
          from: "gtr",
          use: [
            step("wah", {
              ui: {
                cols: 2,
                rows: 1,
                widgets: {
                  f: {
                    type: "knob",
                    col: 0,
                    row: 0,
                    bind: "Freq",
                    label: "freq",
                  },
                  q: { type: "knob", col: 1, row: 0, bind: "Q", label: "q" },
                },
              },
              automations: [{ param: "Freq", curve: "sweep" }],
            }),
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["gtr"],
      curves: { sweep: { type: "lfo", shape: "sine" } },
      warnings: [],
    },
  },
};

/**
 * The one story with the patch gesture ARMED — the sockets are inert everywhere else, because
 * DomChains only arms them for a host that can answer `onConnect`.
 *
 * It is here to be dragged in: press the free output, pull, release on a free input. That is the
 * gesture the graph did not have (packages/ui-chains/docs/cable.md), and the only way to see it is
 * to do it. What it wrote is printed above the graph, so the result is readable without a console.
 */
export const PatchBench: StoryObj<typeof Bench> = {
  render: () => <Bench />,
};

/** A midi instrument beside an audio effect — a socket is coloured by what it carries, like the cable for it. */
export const TypedSockets: Story = {
  args: {
    graph: {
      chains: {
        notes: {
          from: "notes",
          use: [
            { module: "synth", category: "instruments", emits: AUDIO },
            step("reverb"),
          ],
          out: [{ to: "OUT", gain: 1 }],
        },
      },
      tracks: ["notes"],
      trackSignals: { notes: "midi" },
      warnings: [],
    },
  },
};
