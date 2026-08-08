// inputChannels.ts — what a module preview can be fed FROM: the interface inputs of the
// machine running the engine, named by that machine's preferences where it has named them.
// Pure. See ../../docs/modulePreview.md.

/** One labelled input, as `~/.studio/preferences.yaml` writes it (`ch` is 1-based). */
export interface ChannelLabel {
  ch: number[];
  label: string;
}

/** One thing you can pick on the `in` node. `channels` is what the engine is told. */
export interface InputChoice {
  /** What the menu and the node's chip show. */
  label: string;
  /** 1-based physical channels — one for mono, two for a pair. Empty means "no input". */
  channels: number[];
}

/** Nothing plugged in. First in the list, because unpicking is as ordinary as picking. */
export const NO_INPUT: InputChoice = { label: "aucune", channels: [] };

const key = (ch: number[]): string => ch.join("+");

/**
 * The inputs to offer: the wave inputs the ENGINE reports, named by the machine's preferences
 * where it has named them.
 *
 * Built from the engine's own device layout and NOT from a channel count, because that is the
 * only list every entry of which the engine can actually route. `findWaveInput` matches a
 * device whose channel set is EXACTLY the one asked for, and the engine says so itself:
 *
 *   "an interface's inputs are usually paired into stereo devices, so asking for channel 2
 *    alone matches nothing at all and reads as silence"  — Recording.cpp, channelTap
 *
 * So a menu of "Entrée 1 … Entrée 20" built from `EngineAudioDevice.inputs` would offer twenty
 * rows on a paired rig and route none of them. The measured machine is exactly that case: a
 * 20-input Focusrite, and `channels.in: []` in its preferences.
 *
 * A LABEL wins over the device's own name when it covers the same channels — that is the whole
 * point of naming a channel "arm". A label covering a set no device offers is dropped rather
 * than shown: it would be a row that cannot be routed, which is the thing this list exists to
 * avoid. (The preferences say what the rig is called; the engine says what it can reach.)
 */
export function inputChoices(
  labels: ChannelLabel[],
  devices: { name: string; channels: number[] }[],
): InputChoice[] {
  const named = new Map<string, string>();
  for (const l of labels) {
    const ch = l.ch.filter((n) => Number.isInteger(n) && n > 0);
    if (ch.length && l.label) named.set(key(ch), l.label);
  }
  const out: InputChoice[] = [NO_INPUT];
  const taken = new Set<string>();
  for (const d of devices) {
    const ch = (d.channels ?? []).filter((n) => Number.isInteger(n) && n > 0);
    if (!ch.length || taken.has(key(ch))) continue;
    taken.add(key(ch));
    out.push({
      label: named.get(key(ch)) ?? d.name ?? `Entrée ${key(ch)}`,
      channels: ch,
    });
  }
  return out;
}

/**
 * What the node's chip says for the current pick.
 *
 * Named against the CHOICES rather than remembered beside them, so a label edited in the
 * machine's preferences shows through without the pick having to be made again — the pick is
 * a channel, and the label is only how that machine spells it today.
 */
export function inputLabel(channels: number[], choices: InputChoice[]): string {
  if (!channels.length) return NO_INPUT.label;
  const known = choices.find((c) => key(c.channels) === key(channels));
  return known ? known.label : `Entrée ${channels.join("+")}`;
}
