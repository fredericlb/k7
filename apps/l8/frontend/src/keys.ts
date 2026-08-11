// keys.ts — the web's key bindings. Every discrete shortcut NAMES a command and runs
// through the same path typing it would take, so a key can never drift from the command
// bar. Continuous interaction (caret movement, growing a selection) is deliberately NOT
// here — it belongs to the view that owns it. That line is the rule this table keeps.

// A binding: a command string, a conditional, or alternatives tried in order.
export type Binding = string | { if?: string; command: string } | Binding[];

// Truthy values satisfy `if:` predicates and interpolate into `{name}`.
export type ConditionCtx = Record<string, string | undefined>;

// Sentinel excluding the palette-opener from the completion base-command list; no key binds to it.
export const RESERVED_COMMAND = "@command";

export const KEYS: Record<string, Binding> = {
  // The palette is NOT bound here — it opens on a double-tap of Shift, handled in App's listener.
  // `?` (shift+/) opens the help overlay, a command like any other; keyToken keeps shift, rejecting only meta/ctrl/alt.
  "?": "ui help",
  // These no longer SWITCH view — every pane is already on screen, so they fullscreen one instead.
  "1": "ui editor",
  "2": "ui timeline",
  "3": "ui chains",
  // `f` fullscreens whatever is focused, interpolating the pane into the command name; unset focus goes quiet.
  f: { if: "focus_pane", command: "ui {focus_pane}" },
  // Tab cycles which pane owns the keys, taking Tab from focus traversal — hence the skip-a-focused-control rule.
  tab: "ui focus next",
  // Space is the transport wherever you are, short of a text editor: App's listener lets it
  // through a focused button/link/select where it stands aside for every other key.
  space: "transport toggle",
  enter: "transport rewind",
  // t locates the transport to the timeline caret; quiet on a label, which is a row rather than a beat.
  t: "transport locate",
  // Esc backs out ONE layer, first match winning, outermost thing on screen first: a popin
  // shadows the graph slot, which shadows a fullscreen pane, which shadows the bottom panel.
  // `{current_view}` returns you to the layout you were in, the way `f` interpolates `{focus_pane}`.
  esc: [
    { if: "popin", command: "ui popin close" },
    { if: "graph_slot", command: "ui slot close" },
    { if: "fullscreen", command: "ui {current_view}" },
    "ui close",
  ],
  // m is context-sensitive like `e`: on a clip it names the bare `event move` (the timeline's move mode),
  // otherwise it mutes `caret_track` — unset with no track, so the key resolves to nothing rather than an empty arg.
  m: [
    { if: "hover_midi_sequence", command: "event move" },
    { if: "hover_audio_clip", command: "event move" },
    { if: "caret_track", command: "track mute {caret_track}" },
  ],
  s: { if: "caret_track", command: "track solo {caret_track}" },
  // r arms the track under the caret. Session state the engine holds, so it writes no file and survives a reload.
  r: { if: "caret_track", command: "track rec {caret_track}" },
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
  // Shift+L makes the selection the loop region, or clears it. Plain `l` stays the caret-right key.
  L: [
    { if: "timeline_selection", command: "transport loop" },
    { if: "timeline_loop", command: "transport loop" },
  ],
};

/**
 * Canonical token for a browser key event, matching the strings used as KEYS keys.
 * Returns null for anything unbindable — including any modifier chord, so ⌘1 / ⌃1
 * stay with the browser (its own tab switching) rather than being stolen here.
 */
export function keyToken(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === " ") return "space";
  if (e.key === "Enter") return "enter";
  if (e.key === "Escape") return "esc";
  // Shift+Tab lands here and cycles FORWARD too: a ring of three is walked in at most two presses.
  if (e.key === "Tab") return "tab";
  return e.key.length === 1 ? e.key : null; // a bare character; named keys above
}

/**
 * Drop focus after a MOUSE activation of a momentary button (M/S/A, transport, a
 * toolbar toggle). Pass it as the button's `onClick` alongside its real handler.
 *
 * This is no longer what saves Space: the shell now takes Space off a focused button
 * outright, because "Space plays" has to hold wherever the last click happened to land
 * (see App's listener). What it still saves is every OTHER single-key binding — `1`,
 * `m`, `s`, `f` — which the listener does stand aside for while a control has focus, so
 * a button reached by pointer would otherwise swallow them all.
 *
 * Blurring on click cuts exactly the pointer case — a Tab-focus is never followed by a
 * click, so the keyboard path is untouched. Not `preventDefault` on pointerdown: that
 * suppresses focus by suppressing the compatibility mouse events, which is both less
 * obvious and more browser-dependent.
 */
export const blurOnClick = (e: { currentTarget: HTMLElement }): void =>
  e.currentTarget.blur();

const interpolate = (s: string, cond: ConditionCtx) =>
  s.replace(/\{(\w+)\}/g, (_, k) => cond[k] ?? "");

/**
 * Resolve a binding to a concrete command line for the current conditions, or null
 * when nothing applies. The first matching alternative wins; a bare string always
 * matches.
 */
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

/** The key bound to a plain command, for tooltips — so a hint can't advertise a key
 * this table doesn't actually bind. */
export const keyForCommand = (command: string): string | undefined =>
  Object.keys(KEYS).find((k) => KEYS[k] === command);

/** A readable label for a key token — the raw tokens are terse ("esc", "Z", "?"). */
export function keyLabel(token: string): string {
  const named: Record<string, string> = {
    space: "Space",
    enter: "Enter",
    esc: "Esc",
    tab: "Tab",
  };
  if (named[token]) return named[token];
  if (token === "Z") return "⇧Z"; // shift+z arrives as the bare token "Z"
  if (token === "L") return "⇧L"; // shift+l (loop) — same bare-token shape as Z
  if (token === "R") return "⇧R"; // shift+r (global record) — same bare-token shape as Z
  return token;
}

/**
 * The base command name(s) a binding names, with any interpolated argument stripped
 * ("track mute {caret_track}" -> "track mute"). A name that is ONLY an
 * interpolation ("{focus_pane}", the `f` binding) has no literal command, so it
 * yields nothing — the help legend describes `f` on its own instead.
 */
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

/**
 * Reverse of KEYS for the help view: each command mapped to the readable label of
 * the key that runs it (first key wins). Derived from the table itself, so the help
 * dialog can only ever show a key this table actually binds.
 */
export function shortcutsByCommand(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [token, binding] of Object.entries(KEYS))
    for (const cmd of baseCommands(binding))
      if (!(cmd in out)) out[cmd] = keyLabel(token);
  return out;
}
