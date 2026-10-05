// keys.ts — the web's key bindings. Every discrete shortcut NAMES a command and runs
// through the same path typing it would take, so a key can never drift from the command
// bar. Continuous interaction (caret movement, growing a selection) is deliberately NOT
// here — it belongs to the view that owns it. That line is the rule this table keeps.

import type { CommandPrefs } from "./commandPrefs";

// A binding: a command string, a conditional, or alternatives tried in order.
export type Binding = string | { if?: string; command: string } | Binding[];

// Truthy values satisfy `if:` predicates and interpolate into `{name}`.
export type ConditionCtx = Record<string, string | undefined>;

// Sentinel excluding the palette-opener from the completion base-command list; no key binds to it.
export const RESERVED_COMMAND = "@command";

/** The rectangle's two, held by FOUR tokens and UNCONDITIONAL: both commands answer in every state, so the shortcut is never dead. */
const COPY_SELECTION: Binding = "selection copy";
const PASTE_SELECTION: Binding = "selection paste";

export const KEYS: Record<string, Binding> = {
  // The palette is NOT bound here — it opens on a double-tap of Shift; `?` opens the help overlay, a command like any other.
  "?": "ui help",
  // Named panes, not ring positions: `2` is the timeline wherever it is, the DESK is `4`, and the VIEWPORT deliberately has none.
  "1": "ui editor",
  "2": "ui timeline",
  "3": "ui chains",
  "4": "ui turntables",
  // `f` fullscreens whatever is focused, interpolating the pane into the command name; unset focus goes quiet.
  f: { if: "focus_pane", command: "ui {focus_pane}" },
  // Tab walks the pages, taking Tab from focus traversal — hence the skip-a-focused-control rule.
  tab: "ui focus next",
  // Space is the transport wherever you are, short of a text editor — App's listener lets it through a focused control.
  space: "transport toggle",
  // Shift+Space replays: back to where playback last started, and roll again from there.
  "shift+space": "transport replay",
  enter: "transport rewind",
  // t locates the transport to the timeline caret; quiet on a label, which is a row rather than a beat.
  t: "transport locate",
  // Esc backs out ONE layer, outermost first: a popin, the graph slot, the tool in hand, a page other than home, the panel. First match wins.
  esc: [
    { if: "popin", command: "ui popin close" },
    { if: "graph_slot", command: "ui slot close" },
    { if: "roll_armed", command: "ui roll select" },
    { if: "wave_marks", command: "ui wave standard" },
    { if: "tool_held", command: "ui tool pointer" },
    { if: "fullscreen", command: "ui global" },
    "ui close",
  ],
  // m is context-sensitive like `e`: on a clip the bare `event move`, otherwise it mutes `caret_track`, unset with no track.
  m: [
    { if: "hover_midi_sequence", command: "event move" },
    { if: "hover_audio_clip", command: "event move" },
    { if: "caret_track", command: "track mute {caret_track}" },
    { if: "caret_picture", command: "picture mute {caret_picture}" },
  ],
  s: [
    { if: "caret_track", command: "track solo {caret_track}" },
    { if: "caret_picture", command: "picture solo {caret_picture}" },
  ],
  // r arms the row under the caret — two verbs, the two arms being held in two places (docs/timeline.md).
  r: [
    { if: "caret_track", command: "transport arm {caret_track}" },
    { if: "caret_picture", command: "ui picture arm {caret_picture}" },
  ],
  // Shift+R toggles the GLOBAL record enable — what play DOES with the armed set, not what is armed.
  R: "transport record",
  // e edits the clip under the caret; with none there the binding resolves to nothing.
  e: [
    {
      if: "hover_midi_sequence",
      command: "ui edit sequence {hover_midi_sequence}",
    },
    { if: "hover_audio_clip", command: "ui edit clip {hover_audio_clip}" },
  ],
  // The timeline's selection and zoom. The three that need something to act on are conditional, so they go quiet.
  v: "ui select",
  z: { if: "timeline_selection", command: "ui zoom" },
  Z: { if: "timeline_zoomed", command: "ui zoom out" },
  "0": { if: "timeline_zoomed", command: "ui zoom reset" },
  // Shift+L makes the selection the loop region, or clears it; three conditions, since the clip pane's grids draw the same rectangle.
  L: [
    { if: "clip_selection", command: "transport loop" },
    { if: "timeline_selection", command: "transport loop" },
    { if: "timeline_loop", command: "transport loop" },
  ],
  // Copy the rectangle, paste it at the caret — the clipboard chords FIRST, which is what the help legend advertises.
  "ctrl+c": COPY_SELECTION,
  "ctrl+v": PASTE_SELECTION,
  // The plain letters stay beside them: a hand already on single keys should not reach for a modifier, nor should one arriving from elsewhere.
  c: COPY_SELECTION,
  // `p` is one line whatever is held: the clipboard carries its kind, so the condition is merely that something IS held.
  p: PASTE_SELECTION,
  // `x` deletes what a clip grid's rectangle holds — conditional on a grid being open, since the timeline has no counterpart.
  x: { if: "clip_grid", command: "selection delete" },
  // The MODES of all three surfaces. `a` is the neutral one everywhere and `d` takes something away on two — the pane in FRONT wins both.
  a: [
    { if: "roll_open", command: "ui roll select" },
    { if: "wave_open", command: "ui wave standard" },
    { if: "timeline_active", command: "ui tool pointer" },
  ],
  b: { if: "timeline_active", command: "ui tool cut" },
  d: [
    { if: "roll_open", command: "ui roll remove" },
    { if: "timeline_active", command: "ui tool erase" },
  ],
  // …the roll's own third, and the waveform's other two, where the view IS the gesture (docs/clipEditors.md).
  n: { if: "roll_open", command: "ui roll create" },
  o: { if: "wave_open", command: "ui wave onsets" },
  w: { if: "wave_open", command: "ui wave warp" },
};

/** The clipboard chords, and the ONLY ones this shell takes off the browser; ⌘ and ⌃ produce the SAME token. */
const CHORDS: Record<string, string> = { c: "ctrl+c", v: "ctrl+v" };

/** ⌘/⌃ + a letter → its token, or null for every chord that is not ours. */
const chordToken = (e: KeyboardEvent): string | null =>
  e.altKey || e.shiftKey || (e.metaKey && e.ctrlKey)
    ? null
    : (CHORDS[e.key.toLowerCase()] ?? null);

/** Canonical token for a browser key event — null for anything unbindable, so ⌘1 / ⌃1 stay with the browser. */
export function keyToken(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey) return chordToken(e);
  if (e.altKey) return null;
  // Shift+space still arrives as a space, so the shift is read here; a letter arrives already uppercased.
  if (e.key === " ") return e.shiftKey ? "shift+space" : "space";
  if (e.key === "Enter") return "enter";
  if (e.key === "Escape") return "esc";
  // Shift+Tab lands here and cycles FORWARD too: a ring of three is walked in at most two presses.
  if (e.key === "Tab") return "tab";
  return e.key.length === 1 ? e.key : null; // a bare character; named keys above
}

/** Drop focus after a MOUSE activation of a momentary button — what still saves every single-key binding but Space, which the shell takes outright. */
export const blurOnClick = (e: { currentTarget: HTMLElement }): void =>
  e.currentTarget.blur();

const interpolate = (s: string, cond: ConditionCtx) =>
  s.replace(/\{(\w+)\}/g, (_, k) => cond[k] ?? "");

/** Resolve a binding to a concrete command line for the current conditions, or null — the first matching alternative wins. */
export function resolveBinding(
  binding: Binding | undefined,
  cond: ConditionCtx,
): string | null {
  if (binding == null) return null;
  if (typeof binding === "string")
    return binding === "" ? null : interpolate(binding, cond);
  if (Array.isArray(binding)) {
    for (const b of binding) {
      const r = resolveBinding(b, cond);
      if (r !== null) return r;
    }
    return null;
  }
  if (binding.if && !cond[binding.if]) return null; // condition present, unmet
  return binding.command ? interpolate(binding.command, cond) : null;
}

/** Stored in a CommandPref's `key` when the person took a default shortcut away without giving another. */
export const KEY_NONE = "none";

/** The SIMPLE one-key bindings, with the person's `key:` prefs applied — vacate all, then assign all; the CONDITIONAL ones stay the app's. */
export function effectiveKeys(prefs: CommandPrefs): Record<string, string> {
  const eff: Record<string, string> = {};
  for (const [token, b] of Object.entries(KEYS))
    if (typeof b === "string") eff[token] = b;
  for (const [canonical, p] of Object.entries(prefs))
    if (p.key)
      for (const t of Object.keys(eff)) if (eff[t] === canonical) delete eff[t];
  for (const [canonical, p] of Object.entries(prefs))
    if (p.key && p.key !== KEY_NONE) eff[p.key] = canonical;
  return eff;
}

/** What a pressed token runs: the effective simple map first, falling through to KEYS only for a CONDITIONAL binding. */
export function resolveToken(
  token: string,
  cond: ConditionCtx,
  eff: Record<string, string>,
): string | null {
  const own = eff[token];
  if (own !== undefined) return own;
  const b = KEYS[token];
  return b === undefined || typeof b === "string"
    ? null
    : resolveBinding(b, cond);
}

/** The key bound to a plain command, for tooltips — read off the effective table, so a hint cannot advertise a key nothing binds. */
export const keyForCommand = (
  command: string,
  prefs?: CommandPrefs,
): string | undefined => {
  if (prefs) {
    const eff = effectiveKeys(prefs);
    return Object.keys(eff).find((k) => eff[k] === command);
  }
  return Object.keys(KEYS).find((k) => KEYS[k] === command);
};

/** A readable label for a key token — the raw tokens are terse ("esc", "Z", "?"). */
export function keyLabel(token: string): string {
  const named: Record<string, string> = {
    space: "Space",
    "shift+space": "⇧Space",
    enter: "Enter",
    esc: "Esc",
    tab: "Tab",
    // Spelt out rather than as a glyph, which too few people read at a glance; on a Mac it is ⌘ that fires it — see CHORDS.
    "ctrl+c": "Ctrl+C",
    "ctrl+v": "Ctrl+V",
  };
  if (named[token]) return named[token];
  // A shifted letter arrives as its own uppercase token, so the shift is spelt out whichever letter is bound.
  if (/^[A-Z]$/.test(token)) return `⇧${token}`;
  return token;
}

/** The base command name(s) a binding names, with any interpolated argument stripped; one that is ONLY an interpolation yields nothing. */
function baseCommands(binding: Binding | undefined): string[] {
  if (binding == null) return [];
  if (typeof binding === "string") {
    if (!binding || binding === RESERVED_COMMAND) return [];
    const base = binding.replace(/\s*\{[^}]*\}$/, "").trim();
    return base ? [base] : [];
  }
  if (Array.isArray(binding)) return binding.flatMap(baseCommands);
  return baseCommands(binding.command);
}

/** Reverse of the keymap for the help view — derived from the effective table, so it can only ever show a key that actually binds. */
export function shortcutsByCommand(
  prefs: CommandPrefs = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [token, cmd] of Object.entries(effectiveKeys(prefs)))
    if (!(cmd in out)) out[cmd] = keyLabel(token);
  // The conditional bindings, by their base commands — the app's, exactly as resolveToken keeps them.
  for (const [token, binding] of Object.entries(KEYS)) {
    if (typeof binding === "string") continue;
    for (const cmd of baseCommands(binding))
      if (!(cmd in out)) out[cmd] = keyLabel(token);
  }
  return out;
}
