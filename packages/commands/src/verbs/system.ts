// system.ts — the `system …` verbs: what belongs to the MACHINE rather than to a project. The
// plugin cache it scanned, its interface's labels and pairing, and the chain it splits a song into
// stems with. All of them work with no project open, which no other group can claim.

import { resolveChain } from "@studio/audio-passes/processChain";
import {
  clearChannelLabel,
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  parseChannels,
  setChannelLabel,
  setInputPair,
  setStemsChain,
} from "@studio/song/preferences";
import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const SYSTEM_VERBS: Record<string, SidHandler> = {
  // The MACHINE's plugin cache, not this song's modules; the optional word is a format filter.
  "system.plugins.list": async (a, h) => {
    await h.listPlugins(a.trim() || undefined);
  },
  "system.plugins.scan": async (_a, h) => {
    h.log(["rescanning plugins… (first scan can take a while)"]);
    await h.rescanPlugins();
  },

  // --- channel labels: shown here, but the interface is CHOSEN in « État du moteur » ---
  "system.channel.list": (_a, h) => {
    const p = loadPreferences();
    const f = formatChannels(p);
    h.log([
      `audio device: ${formatAudioDevice(p.audioDevice)}  (change: médiathèque → État du moteur)`,
      `in:  ${f.in || "(none — set with: channel in <ch> <label>)"}`,
      `out: ${f.out || "(none — set with: channel out <ch> <label>)"}`,
    ]);
  },
  "system.channel.set": (a, h) => {
    // channel <in|out> <chans> <label…>   e.g. channel in 3+4 synth
    const m = a.trim().match(/^(in|out)\s+(\S+)\s+(.+)$/i);
    if (!m)
      return h.refuse([
        "usage: system channel set <in|out> <chans> <label>   e.g. system channel set in 3+4 synth",
      ]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length)
      return h.refuse([`bad channels '${m[2]}' — use e.g. 1 or 3+4`]);
    setChannelLabel(dir, ch, m[3].trim());
    h.log([`${dir} ${ch.join("+")} = ${m[3].trim()}`]);
  },
  "system.channel.clear": (a, h) => {
    // system channel clear <in|out> <chans>
    const m = a.trim().match(/^(in|out)\s+(\S+)/i);
    if (!m) return h.refuse(["usage: system channel clear <in|out> <chans>"]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length) return h.refuse([`bad channels '${m[2]}'`]);
    clearChannelLabel(dir, ch);
    h.log([`cleared ${dir} ${ch.join("+")}`]);
  },
  /** Two inputs as one device: TWO writes, preference first — ui-module-builder/docs/inputChannels.md. */
  "system.channel.type": (a, h) => {
    const [chArg, modeArg] = splitWords(a);
    const mode = (modeArg ?? "").toLowerCase();
    if (!chArg || (mode !== "mono" && mode !== "stereo"))
      return h.refuse([
        "usage: system channel type <channel> <mono|stereo>   e.g. system channel type 3 stereo",
      ]);
    const channel = Number(chArg);
    if (!Number.isInteger(channel) || channel < 1)
      return h.refuse([
        `'${chArg}' is not a channel — they count from 1, and either half names the pair`,
      ]);
    const stereo = mode === "stereo";
    const first = channel % 2 === 1 ? channel : channel - 1;
    setInputPair(channel, stereo);
    const heard = h.setInputStereo?.(channel, stereo) ?? false;
    h.log([
      `in ${first}+${first + 1} is ${stereo ? "one stereo device" : "two mono devices"}` +
        // No engine still did the durable half, which is not the same as doing nothing.
        (heard ? "" : " — remembered; the engine hears it on its next connect"),
    ]);
  },

  /** Which chain separates a record, remembered once and checked here — see docs/playlist.md. */
  "system.stems": (a, h) => {
    const ref = a.trim();
    if (!ref)
      return h.refuse([
        "usage: system stems <chaîne>   e.g. system stems @st0/stems",
        h.stemsChain
          ? `currently: ${h.stemsChain} — pass "" to clear it`
          : "nothing is set, so nothing on this machine will separate a record",
      ]);
    // `""` on the line, quotes and all: the way to say "separate nothing" without a second verb.
    if (ref === '""' || ref === "''") {
      setStemsChain("");
      return h.log(["the separating chain is cleared"]);
    }

    let checked = "";
    if (h.songPath) {
      try {
        const chain = resolveChain(h.songPath, h.project(), ref);
        if (!chain.cold.length)
          return h.refuse([
            `'${ref}' does not separate — this wants a chain whose step is an offline module`,
          ]);
        checked = ` — separates with ${chain.cold.map((c) => c.step).join(", ")}`;
      } catch (e) {
        return h.refuse([`system stems: ${(e as Error).message}`]);
      }
    } else {
      // Not a failure: `system` verbs work with no project — see docs/playlist.md.
      checked = " — not checked: no project is open to resolve it against";
    }
    setStemsChain(ref);
    h.log([`stems are separated with ${ref}${checked}`]);
  },
};
