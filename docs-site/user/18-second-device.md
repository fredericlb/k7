# Driving k7 from another device

A tablet beside your decks, a phone in your hand on stage: a second device can drive the **same engine, in the same session** as the computer running your project. What you do on one is done on the other.

There are two ways to use a second device:

- open the **whole project** on it, as on the computer, or
- open **one surface alone** on it: the DJ desk, the timeline, the master strip or the picture frame, full screen, with a small transport.

## Surfaces

A project declares its special views — its *surfaces* — in its `surfaces/` folder (see the Song file reference). Each one has a name (its id) and a type: `timeline`, `turntables`, `mastering` or `viewport`. Any of them can be opened alone on another device.

## Getting the address onto the device

### Scan a QR code

Open the **Share** panel (`ui share`). Its **On another device** section shows one QR code for the whole project, then one per surface. Scan it with the device's camera.

In k7 opened from the [tray](./82-desktop-app.md), at `127.0.0.1`, no code is shown: that address answers only the computer itself, so a phone could not open it. To drive the computer's engine from a phone, list the engine at a k7 server such as `app.k7.rocks` (the tray's engine page, **Studios**) and open the project there.

### Copy the link

`ui external <surface>` copies the surface's link to the clipboard and shows it on the status line. A surface's address is the project's address followed by `/@external/<surface>`, for example:

```text
/@local/band/winter.k7/@external/desk
```

### The surfaces menu

On the device, open `/external` on your k7 address. This page lists **every surface of the project the engine is playing right now**, with an icon for its type. Tap one to open it. The list refreshes every five seconds and has a refresh button.

The menu only offers the project already open on the engine: joining it never moves the engine to another project. If nothing is open, it says so; open the project in the editor first.

You can install `/external` as an app on the device's home screen: it then opens straight on the surfaces menu.

## A surface on its own

A surface opened alone shows:

- at the top, **play/pause and the clock**;
- the surface itself, full screen;
- at the bottom, one **command line**, a full-screen button and a way back to the surfaces menu.

The screen stays awake while a surface is open.

The keyboard works as in the editor, with your own key bindings: `Space` plays, `Shift+Space` replays, the timeline keys move the caret, zoom and loop, and double-`Shift` focuses the command line. Commands that only make sense in the full editor (opening panels, other pages…) answer with a message instead of acting. Right-click entries that need an argument are pre-written in the command line.

A surface type that cannot be drawn alone on a device says it is drawn in k7's window instead.

## Pairing a device on your local network

When the second device reaches the engine directly over your local network (for example an engine at home, without going through a server), the engine only answers devices its machine has approved.

On the device, a card says **This device isn't paired** with the machine's name:

1. Tap **Pair this device**.
2. The device shows a **code**.
3. On the machine running the engine, a card appears at the top right: "*<device>* wants to pair", with its network address and the same code. Check the code matches, then click **Approve** (or **Deny**).
4. The device is paired; the approval is remembered.

A request nobody answers expires after two minutes. The machine's **Paired devices** list on the Settings page shows every paired device with **Revoke**. It can only be managed from the machine running the engine. More on engines and pairing machines is in the Engines section.
