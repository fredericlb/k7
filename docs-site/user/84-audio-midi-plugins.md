# Audio interfaces, MIDI and plugins

This page covers the hardware and software around the engine: which audio interface it plays through, how your MIDI controllers reach it, and which plugins it can load.

## Choosing the audio interface

The audio interface is a fact about the **engine's machine**, not about a song, so you set it on that machine, not from a browser:

| Where the engine runs | Where you set the interface |
|---|---|
| The tray, on your computer | The engine page (**Engine Settings…** in the tray menu), *Audio interfaces* section ([The tray](./82-desktop-app.md#audio-interfaces)) |
| Command-line engine | The `audioPriority` key of the config file ([The command-line engine](./81-command-line-engine.md#every-key)) |
| Android app | Nothing to set: the phone's own audio device is used |

### How the priority list works

You give a list of interfaces, best first. The engine uses the **first one in the list that is plugged in**. There is no default and no separate fallback: the second line of the list is the fallback.

- Plug in an interface that is higher in the list, and the engine moves to it within about ten seconds.
- Unplug it, and the engine moves to the next one in the list that is present.
- If a switch fails, the engine does not keep retrying; it tries again when the set of plugged-in interfaces changes.
- An interface that is not in the list is never chosen automatically. If nothing in the list is present, the engine stays on whatever it has open.
- The list is saved first and applied second, so an interface that refuses to open does not lose your order.

To find the exact names, look at the list on the tray's engine page, or run `k7-runtime --list-audio-devices` next to the command-line engine. Names are matched exactly.

On Windows, ASIO drivers are supported as well as Windows Audio. On macOS the engine uses CoreAudio, on Linux ALSA.

### Buffer size and latency

When it opens an interface, the engine asks for a **256-frame** buffer, or the nearest size the device offers (preferring the larger on a tie). If the driver does not let the engine choose, the driver's size stays. The buffer is half of the latency figure k7 shows: twice the buffer period. At 48 kHz, 256 frames is about 11 ms of audio latency.

On a phone, the engine grows the buffer by one step whenever the audio underruns, up to 40 ms.

If the engine opens no output device at all, the transport appears to run but nothing sounds and the playhead does not move. The engine log says so: *no audio OUTPUT device is open*.

### Inputs, labels and the headphone output

Some settings describe your rig rather than a song. They are typed in the command bar and kept in your preferences, so every project sees them:

| Command | What it does |
|---|---|
| `system channel list` | Shows the labels given to input and output channels |
| `system channel set in 3+4 synth` | Labels channels (one channel, or a pair like `3+4`) |
| `system channel clear in 3+4` | Removes a label |
| `system channel type 3 stereo` | Groups an input pair into one stereo input (`mono` splits it); either half names the pair |
| `system cue 3+4` | Sets the output pair the headphone CUE bus leaves by; empty clears it |

Choosing which input a track records from is part of arranging and recording; see that section of this guide.

## MIDI controllers and keyboards

MIDI devices plug into the device that runs the **browser**, not the engine's machine. k7 reads them with the browser's Web MIDI support, so a keyboard on your laptop plays an engine in another room. Use a browser with Web MIDI (Chrome, Edge, or other Chromium-based browsers).

- **Playing a track live:** the browser sends each note to the engine, which plays it through that track's chain.
- **Recording MIDI:** notes are captured in the browser, timed in song beats, and written into a sequence. The engine records audio only.
- **Controlling parameters:** `module cc` binds a MIDI control change to a module's parameter. The binding is stored with the module, so it follows the module into every project.

The details of recording and mapping are in the arranging and chains sections of this guide.

## Plugins

### Which plugins the engine loads

On Windows, macOS and Linux, the engine hosts **VST3** and **LADSPA** plugins found in the standard install locations for each format. The Android engine hosts no third-party plugins. Every engine also has its built-in modules (the sampler, amp modeling, Faust and JavaScript DSP, the eurorack modules, Surge XT on Windows, macOS and Linux, and the others listed in the chains section).

The engine scans for plugins in separate processes, one plugin at a time, so a plugin that crashes during the scan does not take the engine down. The result is cached on the machine, and only new or changed plugins are scanned again.

### Rescanning after installing a plugin

- The tray: the engine page (**Engine Settings…**), **Rescan**.
- From the command bar: `system plugins scan`.
- To see what the engine has: `system plugins list`, or `system plugins list vst3` for one format.

### Opening a plugin's own window

`node external-ui <module>` opens the plugin's own editor window for one instance in the project. The window opens **on the engine's machine**, since that is where the plugin runs.

### A plugin that crashes the engine

When the engine dies while loading a plugin or a model file, it notes which file it was loading. If the same file is being loaded when the engine dies a **second** time, the engine refuses that file from then on, and the rest of the project still loads. Updating or replacing the file lifts the refusal. The engine log names the file.

### Engines with different plugins

A project made on one machine may use plugins another machine does not have. k7 prefers engines that have every plugin the project uses, and the header's warning triangle tells you which ones are missing on the current engine. See [Engines](./80-engines.md#how-k7-picks-an-engine-for-a-project).
