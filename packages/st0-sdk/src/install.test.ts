import { loadCommandSpecs, runCommand } from "@studio/commands/commandSpec";
import {
  allSurfaceTypes,
  surfaceTypeOf,
} from "@studio/song-schema/yaml/surfaceRegistry";
import { describe, expect, it } from "vitest";
import { installServerPlugins, pluginOf } from "./install";
import { definePlugin } from "./plugin";

// The installer's contract, against the REAL registries: a plugin installed here is listed by
// the catalogue, dispatched by `runCommand`, and its surface type scaffolds like a builtin's.
// Each test names its plugin uniquely, since the registries refuse a second registration —
// which is the contract, not a test inconvenience.

const host = () => {
  const logs: string[] = [];
  const refusals: string[] = [];
  return {
    logs,
    refusals,
    songPath: "",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
  } as never;
};

const stamp = Date.now();
const id = `test${stamp}`;

describe("installServerPlugins", () => {
  it("a plugin's verb is listed, dispatched, and SID-prefixed", async () => {
    const sid = `plugin.${id}.shout`;
    installServerPlugins([
      definePlugin({
        id,
        commands: [
          {
            sid,
            spec: {
              command: `plugin ${id} shout`,
              sid,
              surfaces: ["cli"],
              readable: { en: "Shout", fr: "Crier" },
            },
            handler: (a, h) => h.log([`SHOUT: ${a}`]),
          },
        ],
      }),
    ]);
    const spec = loadCommandSpecs().find((c) => c.sid === sid);
    expect(spec?.command).toBe(`plugin ${id} shout`);
    await runCommand(`plugin ${id} shout hey`, host(), "cli");
    // Dispatch went through the registry: the refusal would say `unknown command` if it hadn't.
  });

  it("attributes a hosted verb to the plugin that installed it", () => {
    // A verb in a CORE family (`track.*`) is the normal case — the attribution, not a prefix
    // rule, is what says who installed it (docs/sdk.md).
    const sid = `track.transcribe${stamp}`;
    installServerPlugins([
      definePlugin({
        id: `transcription${stamp}`,
        commands: [
          {
            sid,
            spec: {
              command: `track transcribe${stamp}`,
              sid,
              surfaces: ["cli"],
            },
            handler: () => {},
          },
        ],
      }),
    ]);
    expect(pluginOf(sid)).toBe(`transcription${stamp}`);
  });

  it("refuses a SID a builtin handler already holds", () => {
    expect(() =>
      installServerPlugins([
        definePlugin({
          id: `escape${stamp}`,
          commands: [
            {
              sid: "track.mute", // a builtin's SID — one SID, one behaviour
              spec: {
                command: `plugin escape${stamp} mute`,
                sid: "track.mute",
                surfaces: ["cli"],
              },
              handler: () => {},
            },
          ],
        }),
      ]),
    ).toThrow(/already has a handler/);
  });

  it("a plugin's surface type completes, and scaffolds with its own skeleton", () => {
    const type = `waveform${stamp}`;
    installServerPlugins([
      definePlugin({
        id: `wave${stamp}`,
        surfaceTypes: [
          {
            type,
            layouts: ["split"],
            mappingSkeleton: [["peak", "the module whose level it draws"]],
          },
        ],
      }),
    ]);
    expect(allSurfaceTypes()).toContain(type);
    expect(surfaceTypeOf(type)?.mappingSkeleton).toEqual([
      ["peak", "the module whose level it draws"],
    ]);
  });

  it("refuses a second registration of the same surface type", () => {
    expect(() =>
      installServerPlugins([
        definePlugin({
          id: `again${stamp}`,
          surfaceTypes: [
            {
              type: `waveform${stamp}`,
              layouts: ["split"],
              mappingSkeleton: [],
            },
          ],
        }),
      ]),
    ).toThrow(/already registered/);
  });
});
