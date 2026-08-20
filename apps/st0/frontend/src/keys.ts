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

/**
 * The rectangle's two, held by FOUR tokens — the clipboard chords and two plain letters.
 *
 * UNCONDITIONAL, unlike every other binding here, and that is the one thing worth reading twice.
 * They were conditional — copy on a rectangle being drawn, paste on something being held — which
 * is the rule that keeps a key from being dead. The rule cost more than it bought here: a person
 * who had selected an event by CLICKING it pressed copy, nothing happened and nothing was said,
 * and the paste then told them the clipboard was empty. A key that goes quiet is indistinguishable
 * from one that is broken.
 *
 * Both commands answer in every state now — the copy takes the caret's own cell when no rectangle
 * is drawn (`cellBox`, and the placement under it on a lane), and each says out loud when it found
 * nothing. So the shortcut is never dead: it either does the thing or gives the reason.
 */
const COPY_SELECTION: Binding = "selection copy";
const PASTE_SELECTION: Binding = "selection paste";

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
  // Shift+Space replays: back to where playback last started, and roll again from there.
  "shift+space": "transport replay",
  enter: "transport rewind",
  // t locates the transport to the timeline caret; quiet on a label, which is a row rather than a beat.
  t: "transport locate",
  // Esc backs out ONE layer, first match winning, outermost thing on screen first: a popin
  // shadows the graph slot, which shadows a fullscreen pane, which shadows the bottom panel.
  // `ui global` is the layout itself, which with one of them is just "leave the fullscreen".
  esc: [
    { if: "popin", command: "ui popin close" },
    { if: "graph_slot", command: "ui slot close" },
    { if: "fullscreen", command: "ui global" },
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
  // r arms the track under the caret. Session state the engine holds, so it writes no file and
  // survives a reload — which is why the verb is `transport arm` and not a `track` one.
  r: { if: "caret_track", command: "transport arm {caret_track}" },
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
  // Three conditions rather than two: the clip pane's grids draw the same rectangle (gridCaret.ts),
  // and looping it is the point of drawing one over a bar of a take.
  L: [
    { if: "clip_selection", command: "transport loop" },
    { if: "timeline_selection", command: "transport loop" },
    { if: "timeline_loop", command: "transport loop" },
  ],
  // Copy the rectangle, paste it at the caret — on the clipboard chords FIRST, which is what
  // makes them the pair the help legend advertises (`shortcutsByCommand` takes the first token).
  // ⌃C/⌃V are the only chords this shell takes off the browser; keyToken says why.
  "ctrl+c": COPY_SELECTION,
  "ctrl+v": PASTE_SELECTION,
  // The plain letters stay beside them. This timeline is driven by single keys — `v`, `z`, `m`,
  // `s` — and a hand already there should not have to reach for a modifier; a hand coming from
  // any other application should not have to learn that it must not. Both, then.
  c: COPY_SELECTION,
  // `p` is one line whatever is held: the clipboard carries its kind, so the verb no longer has
  // to. It was two — `clipboard_events` / `clipboard_notes`, one command each — which is why the
  // condition is now merely that something IS held.
  p: PASTE_SELECTION,
};

/**
 * The clipboard chords, and the ONLY ones this shell takes off the browser.
 *
 * ⌘/⌃ + C and V are where a hand already is for copy and paste, and a DAW that answered them
 * with the browser's copy of whatever text happened to be selected would be the odd one out
 * among every application a person has open. Everything else with a modifier stays the
 * browser's — ⌘1/⌃1 is its tab switching — because a web app that holds chords nobody asked it
 * to hold is how one starts feeling broken. ⌃Z/⌃Y never reach here at all: they have their own
 * capture listener in App, the editor's keystroke history having to be spent first.
 *
 * ⌘ and ⌃ produce the SAME token. Which of the two is the clipboard modifier is the platform's
 * business, and a keymap spelling both would be two rows saying one thing.
 *
 * The stand-aside that matters is not here but in App's listener: with text actually selected
 * on the page, ⌃C is the browser's copy and is let through. Here the binding is conditional
 * anyway, so the chord is only ever taken while there IS a rectangle to copy.
 */
const CHORDS: Record<string, string> = { c: "ctrl+c", v: "ctrl+v" };

/** ⌘/⌃ + a letter → its token, or null for every chord that is not ours. */
const chordToken = (e: KeyboardEvent): string | null =>
  e.altKey || e.shiftKey || (e.metaKey && e.ctrlKey)
    ? null
    : (CHORDS[e.key.toLowerCase()] ?? null);

/**
 * Canonical token for a browser key event, matching the strings used as KEYS keys.
 * Returns null for anything unbindable — every modifier chord but the two above, so
 * ⌘1 / ⌃1 stay with the browser rather than being stolen here.
 */
export function keyToken(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey) return chordToken(e);
  if (e.altKey) return null;
  // Shift+space still arrives as " ", so the shift is read here — a letter would arrive
  // already uppercased ("Z"), which is why only the named keys need the modifier spelt out.
  if (e.key === " ") return e.shiftKey ? "shift+space" : "space";
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

/** Stored in a CommandPref's `key` when the person took a default shortcut away without
 *  giving another — "no key" has to be sayable, and an absent field already means "the app's". */
export const KEY_NONE = "none";

/**
 * The SIMPLE one-key bindings — the app's, with the person's `key:` prefs applied
 * (commandPrefs.ts, the settings page's Commands screen).
 *
 * Three rules, in order: a command given a key VACATES its default token (a shortcut is
 * changed, not doubled); an assignment then lands, stealing its token from whatever held it —
 * visibly, since every row of the settings page reads this same map; and KEY_NONE removes
 * without replacing. Vacate-all-then-assign-all, so two prefs trading tokens cannot depend on
 * object order.
 *
 * The CONDITIONAL bindings (the esc ladder, `f`'s interpolation, `m`'s three meanings) are
 * deliberately not in this map: they are rules rather than shortcuts, and stay the app's —
 * the same line keyForCommand has always drawn by matching plain strings only.
 */
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

/**
 * What a pressed token runs: the effective simple map first; a token it does not name falls
 * through to KEYS only for a CONDITIONAL binding. A simple default the person moved or removed
 * is dead here on purpose — found again in KEYS, "change this shortcut" would mean "add one".
 */
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

/** The key bound to a plain command, for tooltips — so a hint can't advertise a key the
 * effective table doesn't actually bind. With prefs, the person's own layer applies (a moved,
 * stolen or removed key reads as such); without, the app's defaults. */
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
    // Spelt out rather than as ⌃, which too few people read at a glance. It is ⌘ that fires it
    // on a Mac, and one label cannot say both without becoming a sentence — see CHORDS.
    "ctrl+c": "Ctrl+C",
    "ctrl+v": "Ctrl+V",
  };
  if (named[token]) return named[token];
  // A shifted letter arrives as its own uppercase token ("Z", "L"…) — spell the shift out,
  // whichever letter a person binds; a lone letter reads as if it were the unshifted key.
  if (/^[A-Z]$/.test(token)) return `⇧${token}`;
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
 * Reverse of the keymap for the help view: each command mapped to the readable label of
 * the key that runs it (first key wins). Derived from the effective table, so the help
 * dialog can only ever show a key that actually binds — the person's own layer included.
 */
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
