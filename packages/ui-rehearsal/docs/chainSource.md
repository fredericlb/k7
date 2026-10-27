# Recording through the account's rehearsal chain

A session's audio comes from one of two places: **Local device**, this device's microphone, or
**K7 chain**, the account's **rehearsal chain**. With no rehearsal chain chosen, the **New session**
button starts on the local device at once; with one, it opens a menu of the two
(`NewSessionButton.tsx`). The rehearsal chain is one of the account's frozen chains, chosen on k7's
Frozen chains page (`apps/k7/frontend/docs/frozenChains.md`) and kept as the file service's
`rehearsalChain` setting (`GET /account/rehearsal-chain`). The take is an ordinary session — same
waveform, same highlights, same upload — because what reaches the recorder is a `MediaStream` like
the microphone's.

## Which chain is chosen once, on the Frozen chains page

Which chain a band records through is a standing answer, like which interface it plays on, so it is
asked where chains are built and not before each take; whether this take goes through it or not is
the one question the menu asks. The recorder therefore draws no list, no preview and no "another
chain": the menu's **K7 chain** names the rehearsal chain. A menu with one live choice would be a
click for nothing, so while there is no chain the button does not open it. The start dialog
(`SessionStartDialog.tsx`) only says what it is opening, and why it failed, with a retry. The button
asks the file service at each click, the chain being chosen on another page, maybe in another tab,
holding back the menu's own opening until the answer, and loads the chain source on demand, since it
carries the engine client the sidebar must not. Only a chain the bench can play live may be chosen
(a **cold** step needs the whole file first), and deleting the chain lets go of the setting.

## The bench plays it, the rehearsal page records it

The rehearsal pages run no DSP and load no plugin. A chain's modules are engine plugins, and the only place they
load is an engine playing a project. So the chain is played on k7's **bench**
(`apps/k7/backend/docs/media/banc.md`) — the `live` rig, input → fader → master — opened on the
address `/@banc/<chain ref>/live.k7`, which puts a **copy** of the chain between the input and the
fader.

The chain is in the address PATH, not in a query: k7's router owns the query and rewrites it within
a frame (`packages/project-shell/docs/launch.md`), and as a path the gate forwards it to the machine
untouched. The machine is the side that decides what the
address means — `benchChainOf` reads it, and the chain is looked up among the ones the library
holds, never joined onto a path.

## A frame nobody sees

The bench is k7's own project page, on the same origin, in an iframe the person never sees
(`RehearsalChainSource.tsx`): it is what loads the chain on an engine, and k7's screen is what does that.
The chain was tuned with that same screen on the Frozen chains page, so it is not shown again here.
A frame rather than a route, because a project page and the home pages are two different apps of
one SPA (`apps/k7/frontend/src/appMain.tsx`), and the take must not leave the page it is recorded on.

The frame is **hidden, never unmounted**, laid out at a real size under `visibility: hidden`.
Unmounting it reloads the bench and lets go of its claim on the engine mid-take.

The take **starts by itself** once the chain is live and every live input of the bench is fed: the
click that started the session is what lets the audio context run.

## The inputs

A frozen chain names its input itself (`input({ channel: … })`, written by `chain save` from the
bench's IN), and the bench opens with IN fed from it. An input left with no channel is the one thing
still asked, since a take cannot start without it: a small dialog lists **every live input of the
bench** that has none — a node whose step carries `monitor` — each with a select of the interface's
inputs (`ChainInputsPicker.tsx`, `src/benchInputs.ts`).

- **The list is the engine's grouping**, read from the bench's socket by an empty `io-levels`: a
  stereo pair is one entry. A lone half of a pair matches nothing on the engine and stays silent, so
  raw channel numbers are not offered.
- **The choice is k7's own command**, `node param <node> @channel 1,2`, sent to the bench's file
  service (`Banc` workspace) with the probe's file token — the line the node card sends.
- **It is remembered per chain, in this browser**, and put back on an IN that names no channel: a
  chain's own input is never overridden by it.

## How the sound reaches the recorder

The engine already broadcasts a session's master bus to any socket that subscribes
(`engine/k7-runtime/docs/broadcast.md`). The page subscribes on its
own socket, on the **bench's session** (`sessionFor("banc", …)`) — the bench plays there, beside your
song rather than instead of it — and the frames go
through `StreamPlayer` into an `AudioWorklet`, then into a `MediaStreamDestination` that the recorder
takes. The engine has no feature of its own for this.

- **Finding the engine.** The bench chooses the engine, not the recorder: the page waits for the registry to list an
  engine whose claims (`heldProjects`) include the bench address it opened, for this account.
  Choosing on both sides would be two policies that can disagree. The bench in turn opens on the
  engine your song is already on, since your files drive one engine at a time.
- **The song stays open.** The bench is a session of its own (`packages/engine-protocol/docs/sessions.md`),
  and the registry lets one account hold its bench beside its song
  (`packages/engine-registry/docs/claim.md`). Both play into the same outputs, so a song left
  playing is heard — and recorded — under the chain.
- **The page's socket says it is a driver**, which is `EngineClient`'s default. That is deliberate:
  a take is running, and with nobody driving the hidden frame the engine would otherwise free the rig
  45 seconds in (`engine/k7-runtime/docs/sessions.md`). It sends no project.
- **Heard here only from a remote engine.** An engine on this machine already plays through the
  interface, so the page plays the stream only when the engine is elsewhere; monitoring a local one
  as well would play it twice, 150 ms apart. The recorder takes the stream either way.
- **The rate is the stream's.** The audio context is built at the first frame's sample rate, since
  the sink does not resample. A rate change mid-take is reported as an error rather than recorded at
  the wrong pitch.

## What to check in a browser

None of this is covered past `chainSource.test.ts` and `packages/file-service/src/frozenChains.test.ts`.

- no rehearsal chain → New session opens the microphone at once, with no menu;
- a rehearsal chain chosen on the Frozen chains page → New session opens a menu of **Local device**
  and **K7 chain**, which names it; picking K7 chain says it is opening it, then the recorder draws the usual live waveform from the chain's output, with no
  frame and no list;
- a chain whose input names no channel → only the input dialog appears, and the take starts once one
  is picked;
- with a song open in another k7 tab → it stays open and loaded, and the bench opens on its engine;
- stop and save → the session is an ordinary one, and the hidden bench is gone.
