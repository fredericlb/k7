import type { EngineClient } from "@studio/engine-browser";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { describe, expect, it } from "vitest";
import { EFFECT_PLUGINS, planEffects, UNMAPPED_EFFECTS } from "./moteurEffects";
import { MoteurPlayer } from "./moteurPlayer";

/** An engine with no socket: it remembers what was sent, which is the whole contract. */
function fakeEngine() {
  const sent: ProjectDoc[] = [];
  const transport: string[] = [];
  let flushed = 0;
  const engine = {
    sendProject: (d: ProjectDoc) => sent.push(d),
    transport: (a: string) => transport.push(a),
    flush: () => {
      flushed += 1;
    },
    onState: () => () => {},
    onConnected: () => () => {},
  } as unknown as EngineClient;
  return { engine, sent, transport, flushed: () => flushed };
}

const player = (
  cached: string[] = ["song.wav"],
  e = fakeEngine(),
): [MoteurPlayer, ReturnType<typeof fakeEngine>] => [
  new MoteurPlayer(e.engine, {
    resolvePath: (p) => (cached.includes(p) ? `C:/cache/${p}` : null),
  }),
  e,
];

describe("mapping the sliders onto engine plugins", () => {
  it("builds nothing at all when every slider is off", () => {
    // Off is ABSENT, not "applied at zero": a chain of seven neutral plugins would cost
    // seven instantiations and colour the sound for nothing.
    expect(planEffects("d", {}).plugins).toEqual([]);
    expect(
      planEffects("d", { lowpass: 0, speed: 10, pitch: 0 }).plugins,
    ).toEqual([]);
  });

  it("knows speed's neutral is 10, not 0", () => {
    // The slider runs 1..30 for 0.1x..3.0x, so zero is not its off position — reading it
    // as one would apply a "speed" effect to every round that never asked for one.
    expect(planEffects("d", { speed: 10 }).unsupported).toEqual([]);
    expect(planEffects("d", { speed: 14 }).unsupported).toEqual(["speed"]);
  });

  it("addresses each plugin on the deck's chain", () => {
    const [p] = planEffects("deck-a", { overdrive: 50 }).plugins;
    expect(p.id).toBe("deck-a:overdrive");
    expect(p.type).toBe("Density");
  });

  it("orders the chain by the mapping, not by the caller's object", () => {
    // A chain's order is audible, and object key order is an accident of how the game
    // happened to build the map.
    const a = planEffects("d", { overdrive: 5, lowpass: 5 }).plugins.map(
      (x) => x.name,
    );
    const b = planEffects("d", { lowpass: 5, overdrive: 5 }).plugins.map(
      (x) => x.name,
    );
    expect(a).toEqual(b);
    expect(a).toEqual(["lowpass", "overdrive"]);
  });

  it("puts the intensity on the plugin's own parameter", () => {
    const [p] = planEffects("d", { highpass: 100 }).plugins;
    expect(p.params).toEqual({ Highpass: 1 });
    // …and lowpass runs the other way: 100 means "cut everything", i.e. the control at 0.
    expect(planEffects("d", { lowpass: 100 }).plugins[0].params).toEqual({
      Lowpass: 0,
    });
  });
});

// The heart of it. In a blind test, an effect that silently does nothing means the players
// heard an easier song than the round claimed — and nobody finds out, because clean audio
// sounds correct.
describe("saying what it cannot do", () => {
  it("reports speed and pitch as unsupported rather than approximating them", () => {
    const { plugins, unsupported } = planEffects("d", { speed: 20, pitch: 5 });
    expect(plugins).toEqual([]);
    expect(unsupported).toEqual(["pitch", "speed"]);
  });

  it("reports a slider it has never heard of", () => {
    expect(planEffects("d", { telepathy: 30 }).unsupported).toEqual([
      "telepathy",
    ]);
  });

  it("carries them onto the state the game already subscribes to", () => {
    const [p] = player();
    p.setEffects({ pitch: 3 });
    expect(p.getState().unsupported).toEqual(["pitch"]);
  });

  it("covers every slider z0 offers, mapped or refused", () => {
    // The guard against a tenth slider arriving upstream and silently doing nothing here.
    const known = new Set([
      ...Object.keys(EFFECT_PLUGINS),
      ...UNMAPPED_EFFECTS,
    ]);
    for (const key of [
      "speed",
      "pitch",
      "lowpass",
      "highpass",
      "phaser",
      "overdrive",
      "chorus",
      "bitreduction",
      "pitchvar",
    ])
      expect(known.has(key)).toBe(true);
  });

  it("refuses to play reversed instead of playing forwards", async () => {
    // Playing a reversed round forwards is one every player answers instantly, and nothing
    // in the game would show why.
    const [p] = player();
    await expect(p.playReversed()).rejects.toThrow(/reversed/);
  });

  it("refuses more decks than it has, rather than truncating", async () => {
    // A stem that never sounds is a wrong answer nobody can trace.
    const [p] = player(["a.wav", "b.wav", "c.wav"]);
    await expect(
      p.playMulti([{ path: "a.wav" }, { path: "b.wav" }, { path: "c.wav" }]),
    ).rejects.toThrow(/decks/);
  });
});

describe("playing", () => {
  it("sends a document then a transport verb, in that order", async () => {
    const [p, e] = player();
    await p.play("song.wav");
    expect(e.sent).toHaveLength(1);
    expect(e.transport).toEqual(["play"]);
    expect(e.sent[0].tracks[0].clips[0].source).toBe("C:/cache/song.wav");
  });

  it("carries the song's window in SECONDS, not beats", async () => {
    const [p, e] = player();
    await p.play("song.wav", 12, 34);
    const clip = e.sent[0].tracks[0].clips[0];
    expect(clip.sourceFrom).toBe(12);
    expect(clip.sourceTo).toBe(34);
  });

  it("refuses a song this machine has not cached", async () => {
    // The engine opens files; it cannot fetch z0's URL. Sending the path anyway would
    // have it warn once and then play silence, which reads as a working round.
    const [p] = player([]);
    await expect(p.play("absent.wav")).rejects.toThrow(/not cached/);
    expect(p.getState().failedPaths).toEqual(["absent.wav"]);
  });

  it("puts two songs on two decks for a dual round", async () => {
    const [p, e] = player(["a.wav", "b.wav"]);
    await p.playDual("a.wav", "b.wav", 5, 20, 9);
    const [t1, t2] = e.sent[0].tracks;
    expect(t1.clips[0].source).toBe("C:/cache/a.wav");
    expect(t2.clips[0].source).toBe("C:/cache/b.wav");
    expect(t2.clips[0].sourceFrom).toBe(9);
  });
});

describe("preloading", () => {
  it("reports the paths this machine cannot play, before the round starts", async () => {
    const [p] = player(["have.wav"]);
    await p.preloadSong({ path: "have.wav", fullSong: "missing.wav" });
    expect(p.getState().failedPaths).toEqual(["missing.wav"]);
    expect(p.getState().total).toBe(2);
    expect(p.getState().loaded).toBe(1);
  });
});

describe("the knobs", () => {
  it("re-sends the document when a slider moves, without reloading the song", async () => {
    const [p, e] = player();
    await p.play("song.wav");
    p.setEffects({ overdrive: 60 });
    expect(e.sent).toHaveLength(2);
    expect(e.sent[1].tracks[0].plugins.map((x) => x.name)).toEqual([
      "overdrive",
    ]);
    // …and no second play: the engine diffs, so the chain changes under a running transport.
    expect(e.transport).toEqual(["play"]);
  });

  it("does not send anything before there is a song", () => {
    const [p, e] = player();
    p.setEffects({ overdrive: 60 });
    expect(e.sent).toEqual([]);
  });

  it("mutes one deck of a multi round", async () => {
    const [p, e] = player(["a.wav", "b.wav"]);
    await p.playMulti([{ path: "a.wav" }, { path: "b.wav" }]);
    p.muteMultiTrack(1);
    const last = e.sent[e.sent.length - 1];
    expect(last.tracks[0].mute).toBe(false);
    expect(last.tracks[1].mute).toBe(true);
  });

  it("turns a 0..1 gain into dB, and silence into a floor rather than -Infinity", async () => {
    const [p, e] = player();
    await p.play("song.wav");
    p.setGain(0.5);
    expect(e.sent[e.sent.length - 1].tracks[0].inputGain).toBeCloseTo(-6.02, 1);
    p.setGain(0);
    expect(e.sent[e.sent.length - 1].tracks[0].inputGain).toBe(-100);
  });
});

describe("ending a round", () => {
  it("flushes the engine rather than leaving the song loaded", async () => {
    const [p, e] = player();
    await p.play("song.wav");
    p.unload();
    expect(e.flushed()).toBe(1);
    expect(p.getState().isPlaying).toBe(false);
  });
});

describe("the reactive snapshot", () => {
  it("hands a NEW object each time, or nothing would ever re-render", () => {
    const [p] = player();
    const before = p.getState();
    p.setEffects({ pitch: 1 });
    expect(p.getState()).not.toBe(before);
  });

  it("notifies subscribers", () => {
    const [p] = player();
    let n = 0;
    const off = p.subscribe(() => n++);
    p.setEffects({ pitch: 1 });
    expect(n).toBe(1);
    off();
    p.setEffects({ pitch: 2 });
    expect(n).toBe(1);
  });
});
