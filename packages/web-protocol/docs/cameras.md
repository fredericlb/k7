# Remote cameras

A device of yours — a phone on a stand, a tablet, a second laptop — becomes a **camera** with the
home page's `camera mode` command. Its screen shows what its lens sees, and the same picture is
offered to every project of the same account on the same server, where a camera node names it
`remote:<device name>`. `cameras.ts` is the contract both halves read: the paths, the frames, and
which camera a label names.

## A remote camera is an ordinary camera node

There is no new `io` type. A remote camera is `@meta/CAM` with a label that starts with `remote:`:

```k7x
// nodes/stage.k7x
extends("@meta/CAM")
camera("remote:Stage left")
```

So everything a camera already is applies unchanged: it feeds a picture lane or draws a layer of its
own, `monitor:` opens and shuts it, an armed lane records it, `validate()` refuses the same cables
(`packages/song/docs/camera.md`). A second `io` type would have meant teaching the schema, the
compiler, the graph and the recorder a word that means the same thing as the one they know.

The label is resolved by the browser drawing the lane, like a local one: `VideoCanvas` hands a
`remote:` label to `remoteCameraLens` and anything else to the machine's opener. The module
picker's **remote camera** entry is a `CAM` node born with `camera("remote:")`; its dropdown lists
the cameras that are on beside the local lenses.

## Named by the DEVICE, matched loosely, never refused

A camera is listed under the name it was started with — the device's own by default
(`deviceName()`, "Android device · Chrome"), or the one given to `camera mode <name>`, which the
device remembers. Two cameras of one account under one name get ` (2)`, ` (3)`: a label that names
two lenses names none.

`matchRemoteCamera` follows `matchCamera`'s rule for the same reasons: exact, then ignoring case,
then containment. `remote:` alone is the newest camera that is on. A name that is not on falls back
to the newest one, and the lane says which it shows and which are on — a project opened on a day the
phone is called something else still draws a picture.

## The server carries signalling, never the picture

The picture goes **peer to peer**, device to browser, over WebRTC. k7's backend only relays the
offer, the answer and the candidates (`apps/k7/backend/docs/cameras.md`). A video stream through
the server would be its bandwidth for every viewer of every account, for a link that both ends can
usually make themselves.

What that costs: two devices on different networks need a STUN server to find each other, and a
TURN server when no direct path exists. The repository ships none and calls no public one —
`K7_CAMERA_ICE_SERVERS` is how a deployment names its own, and the backend hands them to both ends
with the ticket. Unset, a camera reaches a viewer on the same network.

## One account, one server

A camera is visible to the account that started it, on the server it started on, and to nobody
else: the hub pairs a viewer only with a camera of the same account. There is no sharing and no
cross-server listing. On the tray the page's origin is this computer's backend, so it lists the
cameras started against **this computer**, not the hosted server's.

## Latency: aligned to the slowest, and taken out of a take

A remote picture is late — the network, the jitter buffer, the decode. It cannot be made earlier,
so what can be corrected is decided by what is late relative to what:

- **Remote cameras against each other.** Every remote lens a page draws is measured from WebRTC's
  stats every two seconds (`latency.ts`), and each receiver's `jitterBufferTarget` holds the
  quicker ones back to the slowest one's floor. The floor and not the total: a buffer we stretched
  must not raise the target it was stretched to. A browser without `jitterBufferTarget` measures and
  leaves the lenses as they come.
- **A recorded take against the audio.** A frame arriving at playhead *p* was shot at *p − latency*,
  so a remote take is placed that much earlier on its lane — read at the stop, once it has been
  measured.
- **Against a local camera, live.** Not corrected: holding a local lens back would mean buffering
  its frames, for a live picture whose point is to be live.

The estimate is half the round trip plus the decode plus one frame for the camera's capture and
encode, which are never reported, plus what the jitter buffer holds.

## Camera mode is a screen of the HOME page

It needs no project, no engine and no workspace — only the account — which is what the home page
has. It is a full-screen overlay with the picture, the name it is listed under, how many are
watching, a **Switch** between the device's lenses (front and back on a phone: every viewer's track
is replaced in place) and **Stop**. It holds a screen wake lock: a phone on a stand that dims is a
camera that stops. It needs a secure context, as any camera does; over plain http on a LAN the
command says so.

**Every wait is named and bounded** (`apps/k7/frontend/src/camera/cameraLink.ts`). The status line
says which step it is on: the lens opening (a permission prompt nobody answered stays there, and it
is not the server's fault), then the server. Each server step has ten seconds: the ticket, then the
socket's `hello`. A step that times out is retried like a dropped socket, with its reason on the
line. The reason it is bounded is that an upgrade nobody takes is never refused, only left open: a
proxy or a server that routes the socket nowhere would otherwise hold "connecting" for good.
