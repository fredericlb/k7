# pluginEditors.md — a plugin's own window, on the engine's machine

`PluginEditor.cpp` opens the native editor a VST3 brings with it, keeps it alive between opens,
and persists what the user turns. It is the one TU in the engine that needs Win32, and the one
that draws anything at all.

`PluginEditorController` owns all of it and touches ONLY the plugin-related `Impl` fields — never
a session's `current` or `baseDir` — so it needs an `Impl&` and no friendship. `EngineHost`'s
methods here are delegators that build a temporary per call.

A controller serves **one session**, resolved once at construction rather than per call: every
method reaches for the same one, and looking it up must never CREATE it, since addressing a plugin
is a read. `sess_` is null when there is no such session, and every method treats that as "no such
plugin". Safe for the object's lifetime because it is a per-call transient on the message thread,
which is the only eraser.

## A window hides, it does not close

Building a plugin editor is the slow part — seconds for a big instrument — so `PluginWindow`
overrides `closeButtonPressed` to `setVisible(false)`. The editor stays alive and the next open is
a visibility flip. The host holds the window until the edit is rebuilt.

Autosave is a 5 s `juce::Timer` driven by `visibilityChanged`: only while on screen, since a
hidden window has nothing new to persist. Closing stops the timer and fires one final save, so the
last tweak survives.

The autosave lambda binds through the `Impl`, which outlives the window — not through the
transient controller that created it.

## Getting the window in front

On Windows a background process cannot `SetForegroundWindow` to steal focus. `raiseToFront` nudges
the z-order with a brief always-on-top toggle instead: that needs no foreground rights, and
releasing it keeps the position without pinning the window. Focus may still be refused by the OS,
but the window opens in front rather than behind.

## The icon

Without one, a plugin window shows the bare console-app icon of the engine process.
`pluginIconFor` tries, in order:

1. the plugin's own VST3 **snapshot** —
   `<bundle>/Contents/Resources/Snapshots/<classID>_snapshot(.2.0x).png`, preferring the `2.0x`
   hi-dpi variant;
2. on Windows, the icon embedded in the binary. For a VST3 bundle the real module is inside
   `Contents/x86_64-win/`, so that is what `ExtractIconExW` is pointed at. It is drawn onto a
   **top-down 32-bit DIB** so the OS handles mask and alpha compositing, `GdiFlush()` flushes the
   batch before the bits are read directly, and pre-Vista icons carrying no alpha at all are given
   one from whether the pixel is black.
3. failing both, st0's own icon, compiled in by `juce_add_binary_data` and cached so repeated
   opens do not re-decode the PNG.

Opening a window also seeds the autosave baseline with the state as loaded, so the first tick
saves only a real change.

## Persisting: text params first, `.vstpreset` as the fallback

`persist` prefers text params whenever they fully capture the plugin's state — the brain then
writes them onto the module and drops the `.vstpreset`. "Fully capture" is the same round-trip
`--dump-params-ext` makes (`docs/plugins.md`): a built-in's state IS its params, and an external's
are complete iff an instance carrying only them round-trips to the same blob. That instance lives in
the LIVE edit, one per plugin in `Session::paramProbes`, built on the first save and reused: loading
a large instrument is seconds on the message thread, and the autosave runs every five seconds. Reuse
is sound because every parameter is re-applied before each comparison and the probe never receives
any other state. It dies with the Edit, and with the plugin it probes.

Otherwise the module's own `.vstpreset` is written — never an extended module's.

The whole thing is a no-op when nothing changed since the last save, so the 5 s autosave does not
churn files or trigger reloads while the plugin sits idle.

## Watching parameters

`pumpWatches` samples every watched plugin and reports the ones that moved. The comparison is
against what was last **reported**, not against the previous sample, so a slow drift still
eventually reports.

Exact double comparison is deliberate: the values are read back from the same parameter object, so
an untouched one is bit-identical, and a tolerance would only add a threshold below which a slow
knob appears frozen.

`setParam` is deliberately silent, unlike `applyPluginParams`: it is called at interactive rates
by a control drag, so a bad id would spam stderr. A wrong name still surfaces — the same edit is
persisted and applied through `applyPluginParams`, which warns once per apply. It goes through
`pluginParams` rather than `namedParams`, because a built-in registering nothing is addressed
through its ValueTree properties and a widget dragged on one must move the plugin the same way it
moves any other.

## Presets a module can offer

`listPresets` returns two kinds.

**Programs**, from the plugin's own list — skipped when there is one or none (many VST3s report 1:
nothing to pick), and skipped when it is JUCE's dummy 128-entry `ProgramChange N` list, which JUCE
synthesises from a MIDI program-change parameter whenever the plugin publishes no real one. Those
are not presets, just noise.

**`.vstpreset` files**, under Steinberg's convention `<root>/VST3 Presets/<Vendor>/<Plugin>/…`.
The roots cover user, shared, machine and factory locations, including `%CommonProgramFiles%`. The
walk is recursive, since vendors nest presets in category subfolders, and de-duplicated by
absolute path.

`setPreset` applies to **every live instance** of the module: `pluginsById` is keyed
`"<chain>:<module>"`, so a module reused across chains has several instances sharing its
definition and its `.vstpreset`. The key is split on the FIRST colon — an instance carries a colon
of its own, and `rfind()` took only the text after the last, which for an instance is its instance
name and matched nothing. One `persist` afterwards covers them all: the load changed the state, so
the idle-skip does not fire, and the broadcast the brain follows goes out once.

## Orphan windows

An orphan plugin (`docs/plugins.md`) hangs off no session and no `EngineHost`, so its windows are
a file static rather than a field on anything — the whole point is that there need not BE a
project. The plugins themselves are held by `orphanPluginFor`, so both halves outlive the call and
a reopen is a visibility flip, exactly as for a project's own windows.

No `WarningScope`: an orphan belongs to no project, so its warnings go out unstamped rather than
being attributed to whichever session happens to be open. No save callback either, and that is the
feature rather than an omission — there is nothing this window could persist to.

### `showNativePluginUIOf` is LOOKUP ONLY, and that shape is the point

It must never load, and the pair `prepareNativePluginUI` / `showNativePluginUIOf` exists to make
that possible.

`showNativePluginUIOf` runs on the **message thread**. Loading takes `paramQueryMutex` behind a
plugin construction that has been seen to hang indefinitely on this machine. Doing it here would
not merely make one window slow: it would stall the message thread, and with it the transport, the
meters and every session on the engine — a stuck plugin window taking the whole desk down with it.

So there is no fallback to `orphanPluginFor` "only if a caller skipped the prepare step": that is
exactly the case that cannot be allowed to be slow. Refusing is the correct answer. The caller is
asked to prepare first, on another thread, and one that did not gets a warning rather than
silently borrowing the message loop to load a synth.

`snapshotOrphanPluginTo` refuses to load for the same reason. A `false` from `saveVstPreset` there
means "this plugin has no state to write", which is a real answer for some plugins and not a
failure to be papered over with an empty file.
