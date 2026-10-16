# Troubleshooting engines

Start with the engine machine's **log**. It is `.studio.log` in the engine's state folder: `~/.k7` for the command-line engine, `engine-home` inside the desktop app's folder for the app. In the editor, the **Logs** panel shows the same lines for the engine your project is bound to. Each line is tagged: `[host]` for the supervisor, `[engine]` for the engine, `[registry]` for the studios, `[tunnel]` for the tunnel.

## The engine does not appear in the picker

The picker shows *No engines found*, or your machine is missing from the list.

| Check | How |
|---|---|
| Is the supervisor running? | The desktop app's Engine page, the phone's tray, or the terminal of the command-line engine. |
| Does it list the engine anywhere? | The log says `no registry configured — this engine is listed at no studio` when `registryUrls` is empty. |
| Did the studio accept the heartbeat? | The log says `listed at <studio> (heartbeat accepted)` on success, and `heartbeat to <studio> failed: …` with the reason otherwise. |
| Is the address a k7 studio? | `k7-supervisor --probe <address>`. |
| Is the studio's certificate private? | A failing TLS handshake looks like a studio that does not answer. Trust the CA: see [Connecting a machine](./85-connecting-machines.md#a-studio-with-a-private-certificate). |
| Is the engine stopped? | A stopped engine leaves every studio's list at once. Click **Start**. |

Common heartbeat refusals:

- **`HTTP 403 … this id is bound to another machine's tunnel secret`**: the studio already knows this engine id from another machine. This happens when `engine-id.json` was copied from another computer. Each machine must have its own: delete `engine-id.json` on the copy and restart, and it gets a new identity.
- **`HTTP 409 … id/token mismatch`**: another running engine uses the same id with a different token. The id is freed fifteen seconds after that other engine's last heartbeat.
- **`HTTP 429 … too many new engines from this address`** or **`HTTP 503 … lists as many engines as it takes`**: the studio is limiting new engines. Wait a minute and it retries by itself.
- **`HTTP 400 heartbeat refused — …`**: the studio says which field it refused.

## The engine refuses the page

The engine log says `[client] refused a page from '<site>'`. The engine only accepts direct connections from pages on this computer, on `st0.app`, and on the studios in its list. If you self-host a studio, add it to the engine's studios (for the command-line engine, `registryUrls`) and restart the engine.

## The engine is listed but marked unreachable

The picker shows *unreachable* or *not reachable from this browser*.

- The engine stopped answering in the last few seconds: wait for the picker to measure again (every 15 seconds), or click **Refresh**.
- Its machine is asleep, or lost its network.
- The engine answers over your local network but this device is not paired: the picker offers **Pair this device**. See [Pairing](./85-connecting-machines.md#pairing-a-device-on-the-local-network).
- A row marked **in use** is held by someone else, or by another project. It becomes free when they close it, or after their tab goes to sleep.

## "engine gone" or "bad token" when choosing an engine

- *engine gone — its machine has not sent a heartbeat in the last 15 s*: the engine dropped off the list between the measurement and your click. Check that machine's log.
- *bad token — this engine registered with another token; reload the engine list*: the engine restarted with a new identity. Reload the page.

## The engine will not start

| Message | Meaning and fix |
|---|---|
| `an engine supervisor is already running (pid …) — quit it first` | Only one supervisor per state folder. Quit the other one (the desktop app and the command-line engine use different folders and can run together). |
| `engine binary not found (build it)` | The supervisor found no `k7-runtime` beside it. Keep both binaries in the same folder, or set `STUDIO_ENGINE`. |
| `something already serves :8765 and no pid could be found for it` | Another program holds the engine's port. Stop it, or change `port` in the config. |
| `the app did not start the engine on :8765` (Android) | Quit the app and open it again. |
| The desktop app quits at once with a port error | Port 18789 is in use. Close the other program using it. |

## The engine crashed

k7 shows *The engine crashed and was restarted. The project is being sent to it again; anything playing stopped.* The supervisor restarts a crashed engine on its own, waiting longer after each failed attempt, up to 30 seconds. If the crash happened while loading a plugin or model file twice in a row, the engine refuses that file afterwards and loads the rest; the log names it. Update or replace the file to lift the refusal. See [Plugins](./84-audio-midi-plugins.md#a-plugin-that-crashes-the-engine).

On Android, an engine that stopped cannot restart inside the app: quit the app and open it again.

## Nothing sounds

- The log says *no audio OUTPUT device is open*: no interface in your priority list is plugged in, or the one chosen refused to open. Fix the list ([Audio interfaces](./84-audio-midi-plugins.md#choosing-the-audio-interface)).
- The project is playing on a different machine than the one you are sitting at. The engine switch in the header names the machine. Move the project to your own engine, or listen where the engine is.
- The server's engine has no speakers; its sound plays in the browser. Make sure the tab is allowed to play audio.

## The project plays on the wrong machine, or does not match

- The warning triangle next to the engine name lists plugins this engine does not have. Pick an engine that has them, or install them on this one and **Rescan**.
- *This module needs the sampled instrument "…"*: download it on the engine's machine ([Sampled instruments](./80-engines.md#sampled-instruments)).
- *The project could not be loaded on the engine*: some audio files did not reach the engine's machine. Check the machine's free disk space and network, then click **Reload project**.

## Latency is too high

The badge shows the total: network plus audio interface.

- **Network part high**: you are probably going through the studio's relay. Put the browser and the engine on the same local network; the direct peer-to-peer path then usually wins. Opening k7 on the engine's own machine is fastest of all.
- **Audio part high**: the interface runs a large buffer. The engine asks for 256 frames, but some drivers impose their own size; lower it in the interface's own control panel. On a phone, repeated underruns make the engine grow its buffer.
- Q3 (50 ms and more) is fine for listening and mixing, but not for playing live.

## Stem separation is slow or fails

- Separation runs on the CPU by default. Use `system onnx` to try a GPU provider ([Choosing what separation runs on](./86-server-engine-and-jobs.md#choosing-what-separation-runs-on)).
- A command-line engine unpacked without its ONNX Runtime libraries cannot separate at all. Keep the archive's files together.

## Collecting a report

When you report a problem, include the engine machine's `.studio.log`, the platform, and how the engine runs (desktop app, command-line engine, phone or server). On the desktop app, also include `standalone.log` from the app's folder.
