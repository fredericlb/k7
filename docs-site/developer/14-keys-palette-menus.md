# Keys, the palette and the right-click menu

Three entry points — a key, the command bar, a right-click — all end in the same `runCommand(line)`. This page is how each one gets from a gesture to a line.

## Keys

`apps/k7/frontend/src/keys.ts` holds the table `KEYS: Record<token, Binding>`. A binding is:

- a command string (`"transport toggle"`),
- a conditional `{ if: "<condition>", command: "… {name} …" }`, whose `{name}` is filled from the conditions,
- or an array of bindings tried in order, first match wins (the `Esc` ladder, `m`, `a`…).

Only discrete actions are bound. Caret movement and growing a selection belong to the view that owns them (`TimelineTab.tsx`, `hooks/useGridCaret.ts`); that line keeps the table small and every bound key a command.

**Tokens.** `keyToken(e)` turns a `KeyboardEvent` into a token: a bare character (an uppercase letter is its own token, so `R` is Shift+R), `space`, `shift+space`, `enter`, `esc`, `tab`, `backspace`, and only three chords, `ctrl+c`, `ctrl+v`, `ctrl+b`, which `⌘` and `⌃` both produce. Every other chord is left to the browser.

**Conditions.** `App.tsx` computes a `ConditionCtx` memo: `focus_pane`, `popin`, `graph_slot`, `fullscreen`, `caret_track`, `caret_picture`, `timeline_selection`, `timeline_zoomed`, `timeline_loop`, `timeline_active`, `tool_held`, the timeline mode and tool, `wave_open`/`wave_marks` and the wave mode, `roll_open`/`roll_armed` and the roll mode, `clip_selection`, `clip_grid`, `hover_midi_sequence`, `hover_audio_clip`. Conditions that need a surface "in front" are gated on the active pane, so a key never acts on a view off screen.

**The listener.** `apps/k7/frontend/src/hooks/useCommandKeys.ts` is the one global `keydown` listener, shared by the shell and a one-surface device (`ExternalSurface.tsx`). It stands aside while the target is a text field; on a focused button, link or select it lets through only `esc` and tokens bound to `transport …` (Enter stays the control's). It detects the double Shift (two lone presses within `DOUBLE_SHIFT_MS`, 400 ms, ignoring repeats) and hands it to the host. `ctrl+c` with a real DOM text selection is left to the browser. `App` disables the listener while the Commands page or the module builder owns the surface.

Undo and redo (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`) are a separate capture-phase listener in `App.tsx`: in the editor it spends the buffer's own history first, then falls through to the project journal.

**A person's keymap.** `effectiveKeys(prefs)` applies the `key:` of each command pref to the **simple** (string) bindings only: it vacates every token whose command was reassigned, then assigns; `KEY_NONE` takes a default away. `resolveToken` reads that map first and falls back to `KEYS` only for conditional bindings, so the app's context-dependent keys keep working whatever a person rebinds. `keyForCommand` and `shortcutsByCommand` derive tooltips and the help page's legend from the same effective table, so nothing advertises a key that does not bind.

## The palette

`apps/k7/frontend/src/palette.ts` builds the catalogue the bar searches: the file service's `/commands` plus the shell's `LOCAL_COMMANDS`, each with its `readable` sentence resolved once for the locale. `App` then applies the person's layer (`orderCommands`, `labelOf` from `src/commandPrefs.ts`).

- **Ranking** (`rankCommands`): `fuzzyScore` (`src/fuzzy.ts`) against the sentence and against the name (+0.5 on a tie, so typing a command's name finds it), then a recency bonus from `src/recentCommands.ts` (localStorage `k7.recentCommands`, 12 entries) applied **after** filtering, so history reorders matches and never invents one. Nothing is listed for an empty query.
- **Arguments** (`makeListArg`): one round trip per field, fetching the field's whole vocabulary and ranking it in the browser. Fixed sets (`ui panel`, `ui tool`, `ui wave`, `ui roll`, `ui language`, `project export`) and vocabularies only the shell knows (open-able files, tree entries, surfaces) are answered locally; everything else asks `/complete` with the line so far.
- **The form** (`src/commandFill.ts`, pure and tested; `src/components/CommandBar.tsx`, `CommandParams.tsx`): one slot per argument, `""` meaning unanswered, so a field can be filled out of order. `requiredCount` stops at the last non-optional argument; `enterAction` decides between taking a suggestion, running and jumping to the first missing field, and never lets a completed field swallow every Enter. `applyOffer` lets gestures fill fields **forward** from the active one, by argument name; `CARET_ANSWERS` is the explicit list of commands the timeline caret may pre-answer (so no destructive verb is pre-answered by accident).
- `prewrite(text)` parses a line back into command plus values — how a menu entry lands in the bar.

On a phone the bar is a popin instead of docked; `App` dismisses it 150 ms after it loses focus unless a field is pending.

## The right-click menu

`apps/k7/frontend/src/contextMenu.ts` derives entries from the catalogue rather than listing them. A `MenuCtx` says what was clicked (track, group, module, clip, param, curve point or card, chain, sink, assembly, marker or ruler, warp point, picture shot, pad, tap, note) and yields **slots**: the values it can answer, each typed by provider or class. `fromCatalogue` keeps every command whose **leading** arguments match those slots exactly, fills them (quoting values with spaces), and marks whether arguments remain. The catalogue's `menu:` and the person's `menu` pref (`inMenu`) then narrow it. A few hand-written entries (download a model, open the builder) go through the same filter.

An entry with nothing left to ask runs; one that owes an argument is pre-written in the bar. `confirm: true` entries ask through `src/menuConfirm.ts`, showing the exact line. `src/menuTabs.ts` groups rows into tabs by the entity they act on, the `ui` tab last. The menu's row label is the command's name minus the word naming what was clicked; its sentence goes to the status line on hover.

## The Commands page

`apps/k7/frontend/src/components/CommandsSettings.tsx` edits the per-person layer (`CommandPrefs`: `label` per locale, `icon`, `order`, `key`, `menu`) as a **draft** saved on a button. It is one of two screens with a Save button: the prefs are one account-wide document at the app's root, and writing it through per keystroke would re-render the whole shell. Prefs are keyed by the canonical line, never by what is displayed, and are stored in k7's backend preferences (`commands` field, see [the backend](./18-backend-server.md)).

## Tests

`keys.test.ts` (the Escape ladder, transport and clipboard keys, rebinding rules, tool/wave/roll precedence), `commandFill.test.ts`, `palette.test.ts`, `contextMenu.test.ts`, `menuTabs.test.ts`, `commandPrefs.test.ts`, `localCommands.test.ts`, all in `apps/k7/frontend/src`.
