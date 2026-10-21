# k7 on your computer: the tray

The **k7 tray** puts all of k7 on your own computer: the editor, the media library, the rehearsal recorder, a k7 server just for you, the supervisor and the engine. It has no window of its own. It sits as a small icon in the menu bar (macOS) or the system tray (Windows, Linux), and you use k7 in your usual web browser, at an address only your computer answers.

Install it when you want to make music on your own machine without depending on a network connection, or when you want your computer to be the engine for a studio.

For what the engine and supervisor are, see [Engines](./80-engines.md).

## Install

Download the file for your computer from `https://k7.rocks/app_downloads`:

| Platform | File |
|---|---|
| macOS | `k7-tray_<version>_macos-<arch>.dmg` |
| Windows | `k7-tray_<version>_windows-<arch>.exe` (an installer) |
| Linux | `k7-tray_<version>_linux-<arch>.AppImage`, or `.deb` for Debian and Ubuntu |

The tray is not signed. On macOS, Gatekeeper warns on first launch; on Windows, SmartScreen does. Confirm that you want to open it. On macOS the tray asks for microphone access the first time the engine opens your audio inputs: allow it, or your recordings come out silent.

Only one copy of the tray runs at a time. Launching it again opens k7 in your browser.

## The tray menu

Click the icon to open its menu:

| Entry | What it does |
|---|---|
| The status line | What k7 is doing: *Starting k7…*, *Starting the engine…*, *● Engine running · :8765*, *○ Engine stopped*, or a line starting with ⚠ that says what went wrong. While an instrument downloads, a second line shows its progress. |
| **Open k7** | Opens k7 in your browser. |
| **Engine Settings…** | Opens the engine's settings page in your browser (see [The engine page](#the-engine-page)). |
| **Launch at Login** | Starts the tray when you log in to your computer. |
| **Check for Updates…** | Looks for a newer version now. |
| **Check for Updates Automatically** | Lets the tray look for a newer version by itself. |
| **Show Logs** | Opens the log of k7 and its engine. |
| **Quit k7 Tray** | Stops the engine and k7, then quits. |

The icon itself shows the same state at a glance: running, stopped, starting (it turns), or a problem.

## Opening k7 in your browser

**Open k7** opens `http://127.0.0.1:18789` in your browser. That address is your own computer: nothing you do there goes through the internet. You can bookmark it.

You land on k7's home page as the computer's **local user**: you can create workspaces and projects at once, with no account. Your first workspace starts empty.

The library of modules and chains, `@k7-core`, is copied onto your computer the first time it is needed, from the copy bundled with the tray. From then on it is yours to edit like any library.

### Installing k7 as an app

Your browser can install k7 as an app, with its own icon and its own window: in Chrome or Edge, use the install button in the address bar, or the browser menu's **Install k7**. The installed app opens the same address, so it needs the tray to be running.

### Working offline

Everything k7 needs is on your computer: the page, its server, your files and the engine. You can edit and play your projects with no network at all. Only signing in and syncing with a k7 server need a connection.

## Signing in and syncing with k7.rocks

Signing in is optional. Use it when you want your workspaces to sync with a k7 server, such as `https://app.k7.rocks`.

1. On the home page, click the sign-in icon in the **account bar** at the top. Type the address of the server to sync with; it is filled with the last server you chose.
2. Sign in on the page that opens, in the same browser tab.
3. Back on the home page, the account bar asks *Sync this computer's workspaces with …?* Click **Sync**.
4. The server's page opens in a new tab to link this computer to your account. Once it has, the bar says *This computer now syncs with …*.

If that tab is signed in to the server as another person, the bar says so: sign in there with the same account, then add the server again. Signing out returns k7 to the local user. You can add more servers beside the main one from the account bar. See [Signing in](./02-signing-in.md#on-your-computer-and-on-a-phone) and [Sync, history and conflicts](./19-sync-and-history.md).

## The engine page

**Engine Settings…** in the tray menu, or **Engine** in the user menu at the bottom of the home page's sidebar, opens `/settings/engine`, the page that controls this computer's engine. Opened anywhere other than the tray's address, the page says it belongs to a machine running the k7 tray.

### This machine's engine

The status line reads *Running, on port 8765*, *Stopped*, *Stopped — start it again when you need it*, or *Stopped by an error: …*. Under it is the engine's id.

| Button | What it does |
|---|---|
| **Start** | Starts the engine. |
| **Stop** | Stops the engine and removes it from every studio's engine list at once. It stays stopped until you start it. |
| **Restart** | Stops and starts the engine. Use it after a plugin misbehaves. |

If the engine crashes, the supervisor restarts it by itself, waiting a little longer after each failed attempt (up to 30 seconds). The editor then shows *The engine crashed and was restarted. The project is being sent to it again; anything playing stopped.*

### Audio interfaces

Every interface the engine sees, in your order of preference. The engine uses the **first one that is plugged in**. Use the up and down arrows to move an interface. Each row says its backend (for example *CoreAudio*, *Windows Audio*, *ASIO*), and marks the one **in use**, the one taking the **inputs** when that is a different device, and the ones **not plugged in**. Your order is saved even when an interface is unplugged, so plugging it back in moves the engine to it. On Windows, when the engine is on the shared Windows output while your interface has its own ASIO driver, the page offers **Use ASIO**. See [Audio interfaces, MIDI and plugins](./84-audio-midi-plugins.md).

### Studios

The k7 servers this engine is listed at. Your own k7 on this computer is always there. Type another server's address and click **Connect** to offer your computer's engine to that studio too (k7 asks you to confirm first, since that server can then play on your engine); a browser on `app.k7.rocks` can then play its projects on your computer. See [Connecting a machine to a studio](./85-connecting-machines.md).

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

## Updates

The tray looks for a newer version on `k7.rocks` a few seconds after it starts and every six hours, when **Check for Updates Automatically** is on, and whenever you choose **Check for Updates…**. It tells you about a new version once.

- On Windows, macOS and with the AppImage, click **Install and Restart**: the tray stops k7 and the engine, installs the update and starts again.
- With the `.deb`, the tray tells you a new version is out and **Download** opens the download page; install it as you installed the first one.

A tray built from a release follows releases; a snapshot build follows the latest snapshot.

## Ports, and running beside other k7 pieces

| Port | Used by |
|---|---|
| 18789 | k7 in your browser, on this computer only |
| 8765 | The engine, which other devices on your network can reach once you approve them |

The tray's engine is the computer's engine: the same one, in the same `~/.k7` folder and on the same port, as the [command-line engine](./81-command-line-engine.md). Run one or the other on a computer, not both. A k7 development session uses port 8789 and does not get in the way.

A phone or tablet on the same network can drive the engine once you approve it. See [Connecting a machine to a studio](./85-connecting-machines.md).

## Where the tray keeps your files

Your workspaces, media library and preferences go into the operating system's folder for the tray's data (`org.parapluie.studio.engine-tray`, for example under `~/Library/Application Support/` on macOS or `%APPDATA%` on Windows):

| Inside that folder | What it holds |
|---|---|
| `workspaces/` | Your workspaces and projects |
| `mediatek/` | Your media library: songs, samples, recordings |
| `prefs/` | Your preferences |

The engine's state is in `~/.k7`: its identity, settings (`engine-host.json`), plugin scan, paired devices, downloaded instruments, and the log, `.studio.log`, which **Show Logs** opens.

## Quitting

**Quit k7 Tray** stops the engine first, so it leaves every studio's list, then k7, then the tray. The k7 page in your browser stops answering until you start the tray again.
