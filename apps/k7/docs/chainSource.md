# Recording through a chain of st0's library

The third answer to "where should the audio come from?", beside this device and the remote one: a
**chain** of the account's library, played live, and recorded here. The take is an ordinary
session — same waveform, same highlights, same upload — because what reaches the recorder is a
`MediaStream` like the other two.

## st0 plays it, k7 records it

k7 runs no DSP and loads no plugin. A chain's modules are engine plugins, and the only place they
load is an engine playing a project. So the chain is played by st0, on its **bench**
(`apps/pl8/docs/banc.md`) — the throwaway `live` rig, input → fader → master — opened on the
address `/@banc/<chain ref>/live.st0`, which puts a **copy** of the chain between the input and the
fader.

A copy, not a reference: a template cannot be inlined into a host graph
(`packages/song/docs/assemblies.md`), and a copy dies with the bench, so a knob turned while
auditioning reaches nothing shared. Editing the chain for good stays where it is done today, st0's
chains builder.

The chain is in the address PATH, not in a query: st0's router owns the query and rewrites it within
a frame (`packages/project-shell/docs/launch.md`), and as a path the gate forwards it to the machine
untouched, so st0 needed no change of its own. The machine is the side that decides what the
address means — `benchChainOf` reads it, and the chain is looked up among the ones the library
holds, never joined onto a path.

A chain holding a **cold** step (one that needs the whole file first, `cold: true` or `offline`)
cannot run on a live input. The list still shows it, greyed with the reason, rather than dropping
it: a missing entry reads as a library missing a chain somebody knows is there.

## Why a frame

st0 is shown in an iframe so the person can **check** what is about to be recorded: the right chain,
the input picked on the rig's `IN` node, the knobs where they want them. That is st0's own screen;
rebuilding a graph view in k7 would be a second chains editor to keep in step with the first.

The frame is **hidden during the take, never unmounted**. Unmounting it reloads st0 and lets go of
its claim on the engine; kept alive, it can be brought back from the recorder's header (**Chain**)
to adjust a knob mid-take.

## How the sound reaches k7

The engine already broadcasts a session's master bus to any socket that subscribes
(`engine/st0-engine/docs/broadcast.md`), which is what lets z0 be hosted. k7 subscribes on its own
socket, on **st0's session** (`sessionFor("st0", …)`) — the bench plays there — and the frames go
through `StreamPlayer` into an `AudioWorklet`, then into a `MediaStreamDestination` that the recorder
takes. No engine change was needed.

- **Finding the engine.** st0 chooses the engine, not k7: k7 waits for the registry to list an
  engine whose `heldProject` is the bench address it opened, for this account. Choosing on both
  sides would be two policies that can disagree.
- **k7's socket says it is a driver**, which is `EngineClient`'s default. That is deliberate: a
  person is looking at k7, and if st0's frame were gone the engine would otherwise free the rig 45
  seconds into the take (`engine/st0-engine/docs/sessions.md`). It sends no project.
- **Hearing it here is a toggle.** An engine on this machine already plays through the interface,
  so monitoring starts off there and on for a remote engine; either way the recorder takes the
  stream. Monitoring a local engine as well would play it twice, 150 ms apart.
- **The rate is the stream's.** The audio context is built at the first frame's sample rate, since
  the sink does not resample. A rate change mid-take is reported as an error rather than recorded at
  the wrong pitch.

## What to check in a browser

None of this is covered past `chainSource.test.ts` and `packages/file-service/src/benchChain.test.ts`.

- New session → **st0 chain** → the library's chains are listed, cold ones greyed with the reason;
- pick one → st0 opens in the frame on the bench, with the chain between `IN` and `fader`;
- the status goes *waiting* → *connecting* → *live*, and the meter moves when the input is played;
- **Record** → the recorder draws the usual live waveform; **Chain** in its header brings st0 back;
- stop and save → the session is an ordinary one, and the frame is gone.
