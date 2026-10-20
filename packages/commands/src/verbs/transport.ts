// transport.ts — play, stop, toggle, rewind, panic and record-arm, all handed to the
// host's engine. See docs/verbs.md.

import type { SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const TRANSPORT_VERBS: Record<string, SidHandler> = {
  // --- recording — the one lane edit that writes NO file, so it sits under `transport`, docs/verbs.md
  "transport.arm": async (a, h) => {
    const [id, state] = splitWords(a);
    if (!id || (state !== undefined && state !== "on" && state !== "off")) {
      h.refuse(["usage: transport arm <track> [on|off]"]);
      return;
    }
    const p = h.project();
    const matches = (x: { id: string; name: string }) =>
      x.id === id || x.name === id;
    const t = p.tracks.find(matches);
    if (!t) {
      h.refuse([
        p.groups.some(matches)
          ? `"${id}" is a group — arm takes a track (a group carries no input)`
          : `no track "${id}"`,
      ]);
      return;
    }
    // The rule: no input, no arm. A track with nothing feeding it would record silence, so say why instead of arming it.
    if (!t.inputChannels.length) {
      h.refuse([`"${t.id}" has no input — nothing to record`]);
      return;
    }
    if (!p.recordDir) {
      h.refuse([
        `"${p.name}" is a single-file song — it has no clips/ to record into`,
      ]);
      return;
    }
    // undefined == the engine refused or never answered; the host has already said which, and knows more than this.
    // A stated on/off is what a caller that cannot wait for the echo sends: a toggle on a stale reading undoes a fresh arm.
    const armed = await h.arm(
      t.id,
      state === undefined ? undefined : state === "on",
    );
    if (armed !== undefined)
      h.log([`${t.id}: ${armed ? "armed" : "disarmed"}`]);
  },
  "transport.play": (_a, h) => h.transport("play"),
  "transport.stop": (_a, h) => h.transport("stop"),
  "transport.toggle": (_a, h) => h.transport("toggle"),
  "transport.rewind": (_a, h) => h.transport("rewind"),
  // Not a transport MOVE: it stops and then tells every plugin to let go — docs/panic.md.
  "transport.panic": (_a, h) => h.transport("panic"),
};
