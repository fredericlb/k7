# Connecting a machine to a studio

An engine is useful to a studio once two things are true: the studio lists it, and your browser can reach it. This page explains both, and how k7 reaches an engine that sits behind a home router, on a phone, or on another continent.

## Listing an engine at a studio

The engine's supervisor tells a studio about the engine every five seconds. You choose which studios on the engine's machine:

| Engine | How to add a studio |
|---|---|
| Command-line engine | List the studio under `registryUrls` in the config file and restart the supervisor ([The command-line engine](./81-command-line-engine.md)). |
| Android app | **Settings → Studios**, or the tray: type the address and click **Connect** ([The Android app](./83-android-app.md)). |
| Desktop app | The app's engine is listed at the app's own built-in studio. To offer a desktop computer to a remote studio, run the command-line engine on it instead. |

Any address of a studio works: k7 reduces it to the studio's main address, so `docs.k7.rocks`, `app.k7.rocks` and the former `play.st0.app` and `st0.app` are the same studio. Before adding it, the supervisor asks the address whether it is a k7 studio, since the heartbeat carries the engine's secret token. If it is not, nothing is added and the reason is shown, for example *https://example.org is not an k7 instance* or *… did not answer (it redirects)*. The command-line engine can run the same check on its own: `k7-supervisor --probe <address>`.

An engine can be listed at several studios at once. Removing a studio tells it at once, so the engine leaves that studio's picker immediately rather than fifteen seconds later.

## How the browser reaches the engine

When k7 measures an engine, it tries every way to reach it **at the same time** and keeps the fastest that answers:

| Path | When it is offered | What it costs |
|---|---|---|
| **This machine** (`127.0.0.1`) | Always | Nothing: the fastest path, when the engine runs on the computer the browser runs on |
| **Your local network** (the engine's LAN address) | Only when k7 itself is opened over `http://`. A page opened over `https://` may not open an unencrypted connection to a LAN address, so browsers block it. | Pairing, the first time (see below) |
| **Relayed by the studio** | Always, for an engine the studio lists | The studio sits in the middle, so it adds the round trip to the studio |
| **Direct, peer to peer** (WebRTC) | When the engine's supervisor holds a tunnel to the studio | The studio only introduces the two; the sound data goes straight between the browser and the engine's machine. It works when the two can reach each other on the network, typically when they are on the same local network. |

You do not choose a path; k7 shows you the result as one latency figure. Through the relay, a browser can measure any listed engine, but it can play through it only while it holds the engine for a project; a socket that never claims the engine is closed after ten seconds.

### Which web pages may connect directly

The engine only accepts a direct connection from a page served by a site it knows: a page on this same computer (`127.0.0.1` or `localhost`), `https://k7.rocks` and its subdomains, and the studios in the engine's own list. Pages from any other website are refused at once, so a site you happen to visit cannot drive your engine. A studio you add to the list counts from the engine's next start. Programs that are not browsers, such as the supervisor itself, are not affected. An `https://` page on the same network as the engine therefore usually plays over the direct peer-to-peer path, and a browser far away plays through the studio's relay.

### The tunnel

Each supervisor keeps one outbound connection open to every studio it is listed at: the **tunnel**. Because the machine dials out, the studio can reach the engine behind a home router or a firewall with no port forwarding. The studio's relay and the peer-to-peer introduction both go through it. The supervisor redials on its own if the tunnel drops.

### Files travel through the tunnel too

A project's files live on the studio, and the engine plays from its own disk. Before a project opens on an engine, the audio files it needs are copied to the engine's machine (you see *Copying the project to the engine*), into a per-studio folder in the engine's state folder. Only files that are missing or changed are copied. Takes the engine records are sent back up the same way. If some files do not arrive, k7 does not send the project, because those clips would play silent; it offers **Reload project** instead.

## Pairing a device on the local network

An engine trusts any program on its own machine, and anything that reaches it through a studio (the studio has already checked your account). A device that connects **directly over the local network**, such as a tablet on the same Wi-Fi opening k7 over `http://`, must be approved once on the engine's machine.

On the device:

1. The engine picker shows *This device isn't paired with <machine>* with an explanation: over the local network the engine only answers devices its machine has approved.
2. Click **Pair this device**.
3. The device shows a six-digit code: *Approve on the machine running the engine — check it shows this code*.

On the engine's machine, a card appears: *<device> wants to pair. From <address>. Approve only if that device shows this code*, with **Approve** and **Deny**. The card appears in k7 when a page is open on that machine, in the Android app's tray, and in **Settings → Paired devices**.

Check that the codes match before approving: anyone on the network can ask, under any name. The device then shows the engine as usable and k7 continues. If you deny, the device says *The machine refused this device*. If nobody answers within two minutes, the request expires (*Nobody answered within two minutes: the request expired*). At most eight requests can wait at once.

The device remembers its approval in the browser. A private window forgets it when it closes.

### Managing paired devices

**Settings → Paired devices** lists every device allowed to drive this machine's engine, with when it was paired and last seen, and a **Revoke** button. Revoking disconnects the device at once; it must ask again to reconnect. The list can only be managed from the engine's own machine; elsewhere the section says *Manage paired devices from the machine running the engine.*

## A studio with a private certificate

If your studio's HTTPS certificate is signed by your own certificate authority, the supervisor must trust that authority, or every heartbeat fails and the engine never appears in that studio's picker.

- Command-line engine: point `extraCaCerts` at a PEM file of the authority ([config keys](./81-command-line-engine.md#every-key)).
- Desktop app: the supervisor trusts the operating system's certificate store, so install the authority there.
- Android app: **Settings → Private CA → Trust a certificate…** ([The Android app](./83-android-app.md#private-ca)).
