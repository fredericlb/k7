// system.ts — les verbes `system …` : ce qui appartient à la MACHINE et non à un projet. Le
// cache de plugins qu'elle a scanné, les étiquettes et l'appairage de son interface, et la chaîne
// avec laquelle elle sépare un morceau en stems. Tous marchent sans projet ouvert, ce qu'aucun
// autre groupe ne peut dire.

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
  // The MACHINE's plugin cache, not this song's modules — hence `system`. The optional word is
  // a format filter, which is what `module list vst` used to be as a verb of its own.
  "system.plugins.list": async (a, h) => {
    await h.listPlugins(a.trim() || undefined);
  },
  "system.plugins.scan": async (_a, h) => {
    h.log(["rescanning plugins… (first scan can take a while)"]);
    await h.rescanPlugins();
  },

  // --- channel labels (global user preferences) -------------------------------
  // The interface in use is shown here but CHOSEN in the médiathèque's « État du moteur »,
  // which both switches the engine and writes this file (engine/moteur/docs/audioDevice.md).
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
  /**
   * `system channel type <channel> <mono|stereo>` — two inputs heard as one device, or not.
   *
   * TWO writes for one act, and both are needed: the preference is what makes it survive (the
   * engine forgets its grouping across a restart as surely as it forgets which interface to open,
   * and `engineLink` replays this file on every connect), the engine message is what makes it true
   * now. Written first, so a rig that answers slowly still remembers what was asked of it.
   *
   * Either half of the pair names it — `setInputPair` stores the odd one — because the interface
   * pairs even/odd hardware channels and there is no pair 2+3 to describe. Which is also why
   * there is no `in|out` here: an output pair is what a mix already is.
   */
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
        // No engine has still done the durable half, and saying so is the difference between
        // "it did nothing" and "it will be there when the engine is".
        (heard ? "" : " — remembered; the engine hears it on its next connect"),
    ]);
  },

  /**
   * `system stems <chaîne>` — which chain separates a record, remembered once.
   *
   * The ONE place that answer lives. It was asked for at each use — by `playlist stems`, by a
   * desk's surface, by the playlist panel's button — and it is the same answer every time: which
   * module separates and which model it wants is a fact about the library and about this
   * machine's `~/.studio/models`, not about the set list in front of you.
   *
   * Checked while it is set, which is the cheap moment: a chain that does not separate is refused
   * here rather than thirty songs into a set list. A machine with no project open stores it
   * unchecked and says so — a `@st0/…` ref has nothing to resolve against without one.
   */
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
      // Not a failure: `system` verbs work with no project, and this one is worth setting from a
      // shell that has not opened one. What it cannot do is prove the chain is there.
      checked = " — not checked: no project is open to resolve it against";
    }
    setStemsChain(ref);
    h.log([`stems are separated with ${ref}${checked}`]);
  },
};
