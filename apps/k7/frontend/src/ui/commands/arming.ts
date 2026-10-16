// arming.ts — what the shell ARMS: a lane to record, MIDI learn on a param, a picture lane's
// camera. The listening is the browser's in the last two, which is why they are `ui` lines and
// the binding, when there is one, is written by a separate verb (`module cc`, docs/midi.md).

import { m } from "../../paraglide/messages.js";
import type { LocalCommand } from "./context";

export const ARMING_COMMANDS: LocalCommand[] = [
  {
    // Exactly the lane's A button — an instrument track arms in the browser, an audio track in the engine (`r`).
    name: "rec",
    readable: {
      en: "Arm or disarm a lane, as its A button does",
      fr: "Armer ou désarmer une piste, comme son bouton A",
    },
    args: [
      { name: "track", kind: "track", hint: "a sound lane of this project" },
    ],
    match: "names",
    run: (ctx, rest) => {
      const id = rest.trim();
      if (!id) ctx.setStatus(m["status.usage"]({ syntax: "rec <track>" }));
      else ctx.onTrackToggle(id, "arm");
      return true;
    },
  },
  {
    // Arms the browser's Web MIDI; the BINDING is written by `module cc`.
    name: "ui midi learn",
    readable: {
      en: "Learn a MIDI control for a module's parameter",
      fr: "Apprendre un contrôle MIDI pour un paramètre de module",
    },
    args: [
      { name: "module", kind: "module", hint: "a module of this project" },
      { name: "param", kind: "text", hint: "the name its widget binds" },
    ],
    run: (ctx, rest, lower) => {
      // Esc's rung: `runCommand` has already cancelled the pending learn, so there is nothing left to do.
      if (lower === " cancel") return true;
      ctx.armMidiLearn(rest.trim());
      return true;
    },
  },
  {
    // Nothing is written: the camera is the browser's, so the arm is too. Bare, it disarms.
    name: "ui picture arm",
    readable: {
      en: "Arm a picture lane to record its camera",
      fr: "Armer une piste vidéo pour enregistrer sa caméra",
    },
    args: [
      { name: "lane", kind: "text", hint: "a picture lane — bare, it disarms" },
    ],
    match: "names",
    run: (ctx, rest) => {
      const lane = rest.trim();
      ctx.setVideoArmed((cur) => (!lane || cur === lane ? null : lane));
      ctx.setStatus(
        lane && ctx.videoArmed !== lane
          ? m["status.pictureArmed"]({ lane })
          : m["status.pictureDisarmed"](),
      );
      return true;
    },
  },
];
