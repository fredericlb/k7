# The Android app

The k7 Android app turns a phone into a k7 machine. Like the desktop app, it is standalone: it runs its own small k7 server, the supervisor and the engine, so the phone opens its own studio and needs no network. It can also list its engine at other studios, so a browser elsewhere can play through the phone's audio output.

For what the engine and supervisor are, see [Engines](./80-engines.md).

## Requirements

- Android 10 or newer.
- A 64-bit ARM phone (`arm64-v8a`). Other processors are not supported.
- Enough storage for the sampled instruments (see below).

## Setup

1. Install the APK.
2. Open **k7**. The first start unpacks the app's server for a few seconds.
3. Android asks for **microphone** access. The engine opens the audio device with its inputs, so it can record and monitor. If you refuse, the engine still starts, with output only.
4. k7 opens on the phone's own studio, signed in as a local user. Sign in from k7's home page if you want your account; sign-in happens in the phone's browser and returns to the app.

The phone downloads **every** sampled instrument in the background as soon as the supervisor starts, because there is no Downloads list to choose from on the phone. That is several gigabytes; use Wi-Fi the first time.

## What works on the phone

| Works | Does not |
|---|---|
| Playing and recording projects through the phone's audio device | Hosting VST3 or LADSPA plugins: there are none on Android |
| Built-in modules: the sampler (SFZ) instruments, Neural Amp Modeler, Faust and JavaScript DSP modules, the eurorack modules, Strudel pattern lanes, the mixer, recorder and turntable nodes | The Surge XT synthesizer, which is not built for Android |
| k7, the media library and the rehearsal recorder, each full screen | Opening a plugin's own window |
| Being listed at other studios and driven from a browser elsewhere | Running in the background with no page playing |

The engine asks the phone for a 256-frame buffer, or two of the device's bursts if that is larger. If the audio underruns, the engine grows the buffer one step at a time, up to 40 ms, rather than keep crackling.

## Foreground only

The engine lives exactly as long as the app is open:

- The app keeps the screen on while it is in front.
- While a page is **playing**, the app shows a media notification and stays alive with the screen off or with another app in front. Paused, the notification stays, but Android may freeze the app.
- **Leaving the app** (backing out of it, or swiping it away) stops the engine, removes it from every studio's list, and stops the phone's server.
- Rotating the phone does not restart anything.

A stopped engine cannot be restarted inside the same app process. To restart the engine, quit the app and open it again.

## The phone's engine settings

With a studio open, open k7's **Settings** page. On the phone it starts with the phone's engine:

### This phone's engine

The status line reads, for example, *Engine running on ws://192.168.1.23:8765*. The address is the phone's Wi-Fi address, which is what a browser on the same network would dial. Under it: *Listed at every studio*, or *A studio is not answering*. **Quit** stops the engine and the app.

### Studios

Every studio the phone's engine is listed at. The phone's own studio is first. The one k7 is showing says *Open here*; click **Open** on another to switch the app to that studio. **Remove** takes the phone off a studio's list.

To add a studio, type its address (for example `https://studio.example`) and click **Connect**. The app first checks that the address is a k7 studio (*Checking …*) and adds nothing if it is not, showing the reason.

### Private CA

Only for a studio whose HTTPS certificate is signed by a certificate authority of your own. Android keeps the CAs you installed in its Settings out of an app's reach, so you pick the certificate file (`.pem`, `.crt` or `.der`) here with **Trust a certificate…**. The engine and k7 both trust it. **Forget** returns to Android's CAs only. Each change briefly reconnects the engine to its studios.

### Paired devices

The phones, tablets and computers allowed to drive this phone's engine over the local network, and the requests waiting for your answer. See [Connecting a machine to a studio](./85-connecting-machines.md#pairing-a-device-on-the-local-network).

## The tray

When no studio is connected, or the one chosen does not load, the app shows its **tray** instead of k7: the same engine status, the Studios list with **Connect**, the pairing requests with **Approve** and **Deny**, the Private CA section and a **Quit** button. If a studio failed to load, the tray says why and offers **Retry**.

## The name other people see

Engine pickers show the phone under the device name you set in Android's settings (*About phone*), or its model name if you set none.
