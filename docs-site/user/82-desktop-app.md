# The desktop app

The k7 desktop app is all of k7 on one computer: the editor, the media library, the rehearsal recorder, a k7 server just for you, the supervisor and the engine. Install it when you want to make music on your own machine without depending on a network connection, or when you want your computer to be the engine for a studio.

For what the engine and supervisor are, see [Engines](./80-engines.md).

## Install

| Platform | File |
|---|---|
| macOS | `k7_<stamp>_macos-<arch>.dmg` |
| Windows | `k7_<stamp>_windows-<arch>.exe` (an installer) |
| Linux | `k7_<stamp>_linux-<arch>.AppImage` |

The app is not signed. On macOS, Gatekeeper warns on first launch; on Windows, SmartScreen does. Confirm that you want to open it. On macOS the app asks for microphone access the first time the engine opens your audio inputs ("k7 records and monitors audio inputs").

Only one copy of the app runs at a time. Launching it again brings the open window to the front.

## First run

When the app starts it:

1. picks free ports on this computer between **22000** and **23000**, the same ones as last time when they are still free;
2. starts its own k7 server on one of them, `http://127.0.0.1:<port>`;
3. starts the supervisor, which starts the engine on another and lists it at that built-in server;
4. opens the window.

You land on k7's home page as a **local user**: you can create workspaces and projects at once, with no account. Your first workspace starts empty.

The app's library of modules and chains, `@k7-core`, is copied into the app's own folder the first time it is needed, from the copy bundled with the app. From then on it is yours to edit like any library.

## Signing in

Signing in is optional. Use it when you want your workspaces to sync with a k7 server, such as `https://app.k7.rocks`.

1. Click **Sign in** in the tab strip. You may type the address of the server to sync with; the default is `https://app.k7.rocks`, or the last server you chose.
2. Your system browser opens on the sign-in page. Sign in there.
3. The browser shows *Signed in. You can close this tab and go back to k7.* The app now holds your session.

The sign-in waits ten minutes for you in the browser. Signing out, from the strip or the user menu, or a session that expires, returns the window to the local user. After you sign in, the app pairs your account with the server's sync relay, again through the system browser. You can add more servers beside the main one from the home page. Sync itself is described in the editor shell section of this guide.

## The window and its tabs

The tab strip is the window's title bar. The first tab is the **home** tab: it is always there and always shows the home page. Each project you open gets a tab of its own, and opening a project that already has a tab selects that tab instead. Only the tab in front drives the engine. Links to other websites open in your system browser.

## The Engine page

The desktop app adds an **Engine** entry to the user menu at the bottom of the home page's sidebar. It opens the Engine page, which controls the engine built into the app. (In a normal browser this page says it belongs to the desktop app.)

### This machine's engine

The status line reads *Running, on port 22001*, *Stopped*, *Stopped — start it again when you need it*, or *Stopped by an error: …*. Under it is the engine's id.

| Button | What it does |
|---|---|
| **Start** | Starts the engine. |
| **Stop** | Stops the engine and removes it from the studio's engine list at once. It stays stopped until you start it. |
| **Restart** | Stops and starts the engine. Use it after a plugin misbehaves. |

If the engine crashes, the supervisor restarts it by itself, waiting a little longer after each failed attempt (up to 30 seconds). The editor then shows *The engine crashed and was restarted. The project is being sent to it again; anything playing stopped.*

### Audio interfaces

Every interface the engine sees, in your order of preference. The engine uses the **first one that is plugged in**. Use the up and down arrows to move an interface. Each row says its backend (for example *CoreAudio*, *Windows Audio*, *ASIO*), and marks the one **in use**, the one taking the **inputs** when that is a different device, and the ones **not plugged in**. Your order is saved even when an interface is unplugged, so plugging it back in moves the engine to it. See [Audio interfaces, MIDI and plugins](./84-audio-midi-plugins.md).

### Downloads

The sampled instruments the engine can play (see the list in [Engines](./80-engines.md#sampled-instruments)). Nothing is downloaded until you ask: the piano alone is 750 MB.

| Row says | Button |
|---|---|
| the size only | **Download** |
| *waiting for the download before it* | **Cancel** |
| a progress bar, or *unpacking* | none: a download cannot be stopped halfway |
| *download failed: …* | **Retry** |
| *installed* | **Remove** |

### Plugins

How many plugins the engine found on this computer, and the list with each plugin's maker and format. *Scanning…* shows while a scan runs. Click **Rescan** after installing a plugin.

## Ports and running beside other k7 pieces

| Port | Used by |
|---|---|
| 22000–23000 | The app's built-in k7 server, its engine, and its other local services: free ports, kept from launch to launch when they stay free |

The command-line engine uses port 8765 and the `~/.k7` folder, and a k7 development session uses port 8789. The app uses neither, so you can run the desktop app and the command-line engine on the same computer.

The engine listens on your local network too, so a phone or tablet on the same network can drive it once you approve it. See [Connecting a machine to a studio](./85-connecting-machines.md).

## Where the app keeps its files

Everything goes into the operating system's per-app folder (for example `~/Library/Application Support/` on macOS or `%APPDATA%` on Windows), never into `~/.k7`:

| Inside the app folder | What it holds |
|---|---|
| `workspaces/` | Your workspaces and projects |
| `mediatek/` | Your media library: songs, samples, recordings |
| `prefs/` | Your preferences |
| `engine-home/` | The engine's state: its identity, settings (`engine-host.json`), log (`.studio.log`), plugin scan, paired devices and downloaded instruments |
| `standalone.log` | The app's own log |
| `server.json` | The server you chose to sync with |

## Without an engine

If the app finds no supervisor in its bundle, it runs without an engine and says so in `standalone.log`. You can still edit projects and use the media library. To play, pick another engine from the engine switch in the header.
