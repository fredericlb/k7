# The module builder

The module builder edits a module visually: its panel on a grid, its parameters, its DSP source
and its LCD screens, with a live preview of the card it will draw in the chains view. It replaces
the editor beside the file tree while it is open, so the next module is one click away.

## Opening it

- Click a module row in the file tree, or in the file tree's **Libraries** tab.
- On a module or panel file's toolbar, click **Builder**.
- Run `ui builder <module>`.

It opens on the panel, or on the module file when opened from the command. A library module you
are not allowed to edit opens **read-only**, with a lock; an **Edit** button appears where you can
switch to editing.

## Saving

Unlike the rest of k7, the builder does **not** save as you type. A module is several files that
only make sense together, so **Save** (or `Ctrl+S` / `Cmd+S`, or `:w` in vim mode) writes all of
them at once: the module file, the panel, the DSP source and `widgets.js`. The save state shows
"saving...", "not saved" or "save failed" with the reason.

- **Refresh** reloads every file from disk, asking first if something is unsaved.
- **Back** leaves the builder, asking first if something is unsaved.

## The header

| Item | What it does |
|---|---|
| Preset | For an external plugin with factory presets: load one of its programs or factory presets. |
| Status | `listed`, `first` (favourite) or `hidden`: how the command-bar completions treat this module. |
| Refresh | Reload from disk. |
| Save | Write all the module's files. |

## Engines

For a module with several engines, a strip above the builder shows one tab per engine (the
default one marked with a dot) and a **module** tab. An engine tab edits that engine's own files
(`engines/<name>/`); the **module** tab edits the module's own file, where its label and default
engine live. Save before switching engine.

## The file tabs

The left column lists the module's files. A tab gets `*` when it has unsaved changes.

| Tab | Shown when | What it edits |
|---|---|---|
| module | always | The module file, as text. |
| panel | always | The panel file, as text, beside the visual grid. |
| dsp | the module is `jsdsp` or `faust` | `jsdsp.ts` or `dsp.dsp`. |
| widgets | the panel has an LCD screen, or the file exists | `widgets.js`. |
| parameters | always | The list of parameters you can bind. |

Text panes have completion for the module and panel formats, and follow your vim preference.

Below the panes, a preview draws the module as its card. For a live input module, a bar lets you
switch between mono and stereo and choose its channels.

## The parameters list

The parameters tab lists everything a control can bind: the plugin's own parameters (read live
from the engine when available), the values in the module file, and the `@` settings the engine
adds (`@mix`, `@input-volume`, `@output-volume`, `@base`, and on inputs `@gain` and `@monitor`).
Each row shows its range or its number of settings, and a **ui** badge if a control already binds
it. Filter the list with the search box.

Buttons on this tab:

- **greffon** (for `@engine/...` modules): load the plugin and read its parameters. This takes a
  few seconds.
- **Native UI**: open the plugin's own window on the engine's machine. Nothing changed there is
  saved.
- **Snapshot a base**: save the plugin's current state as a named base in the module's `base/`
  folder.

## Building the panel

The right side is the panel grid. Rows are 64 px tall; columns stretch.

1. **Add** a control from the palette: Knob, Slider, Fader, Toggle, Dropdown, File, Button,
   Number, Meter, Waveform, LCD screen, Label, Group. It lands in the first free cell (inside the
   selected group, if one is selected).
2. **Bind** it: drag a parameter from the parameters list onto the control. Dropping a parameter
   on empty grid creates the right control for it: a dropdown for a parameter with named
   settings, a toggle for `@mute`, `@solo` and `@arm`, otherwise a knob with the parameter's range.
3. **Move** a control by dragging it; **resize** it with its corner handles.
4. Adjust `cols` and `rows` with the steppers.

A **group** is a tinted frame. A control belongs to a group when it lies wholly inside it, and
moving the group moves its controls. Double-click a control to select the group around it.
Controls that overlap, or straddle a group's edge, get an amber border.

Right-click a control for **Cut**, **Copy** and **Paste**; right-click empty grid to **Paste**
there. The clipboard lasts the session, so you can copy between modules. Delete a control with
the inspector's **Delete** button. Undo is `Ctrl+Z` in the panel's text pane.

### The inspector

Select a control to edit it below the grid:

| Field | Applies to |
|---|---|
| Type | every control (changing it drops the fields the new type lacks) |
| Label | every control |
| Bound param (drop a parameter here; trash to unbind) | controls that take a value |
| Text | labels |
| Drawn by | LCD screens: the function in `widgets.js` with the screen's id |
| Color, On/off param, "Param is a mute / bypass" | groups |
| Crossfade dry | knobs: the dry parameter of a dry/wet crossfade knob |
| File | file pickers: which file parameter (`model`, `onnx`) |
| Source | waveforms: Output or Input |
| Min, Max, Step, Curve (lin or log) | knobs, sliders, faders, numbers |

### Tabs

The column left of the grid holds the panel's tabs. **Add tabs** splits the panel: what is on it
becomes the first tab, "Main", and a second tab is added. Rename a tab in place (10 characters at
most, unique), move it up or down, or remove it. **Every tab** edits the controls drawn on all
tabs. Removing all but one tab merges them back into a single panel.

### Two layouts

A panel has a **horizontal** layout (at most 4 rows) and, when it is wider than 4 columns, a
**vertical** layout (at most 4 columns) used where cards are drawn narrow. The toggles above the
grid switch between them. **Create the vertical layout** builds one from the horizontal panel.
Both layouts must offer the same controls; problems are listed in amber.

## Organizing a panel automatically

- **Auto organize** sorts the parameters into families (EQ, filter, dynamics, drive, delay,
  reverb, modulation, envelope, oscillator, tuning, mix and others), gives each family a tab, and
  lays knobs out on a grid. Stage settings and the plugin's own dry/wet and level are left off,
  since the card already has them. It asks before replacing a panel.
- **AI organize** (shown when an Anthropic API key is set in Settings, section **AI**) asks Claude
  to lay the panel out, optionally following your directions. On a panel that has controls, choose
  **Reset** or **Update** (Update needs directions). The result is checked (grid bounds, binds that
  exist, the two-layout rules, EQ bands as faders...) and placed in the panel and `widgets.js`
  buffers; nothing is written until you Save. **Copy for Claude Code** copies a prompt to the
  clipboard instead, for a Claude Code session to write the files; then Refresh.

The AI settings take your own API key, which is never shown again after saving, and a model name.

## Assembly templates

`ui assembly <ref>` opens an assembly template in the builder: a table of every member's
parameters, where a checkbox promotes a parameter onto the box's face. See
[Assemblies](./47-assemblies.md).
