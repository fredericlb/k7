import { materialWindow } from "@studio/song-edit/materialWindow";
import { describe, expect, it } from "vitest";
import { decodeTimeSignature, mapLiveSet } from "./ableton";

// These pin the .als readings that fail SILENTLY when wrong — see docs/import.md.

const live = (body: string, version = "12.0_12402"): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="${version}" Creator="Ableton Live ${version.split("_")[0]}">
  <LiveSet>
    <MainTrack><DeviceChain><Mixer>
      <Tempo><Manual Value="110" /></Tempo>
      <TimeSignature><Manual Value="201" /></TimeSignature>
    </Mixer></DeviceChain></MainTrack>
    <Tracks>${body}</Tracks>
  </LiveSet>
</Ableton>`;

const midiTrack = (id: number, name: string, inner = ""): string =>
  `<MidiTrack Id="${id}">
     <Name><EffectiveName Value="${name}" /></Name>
     <DeviceChain>
       <Mixer>
         <Volume><Manual Value="0.5" /></Volume>
         <Pan><Manual Value="-1" /></Pan>
         <Speaker><Manual Value="true" /></Speaker>
       </Mixer>
       <MainSequencer><ClipTimeable><ArrangerAutomation><Events>${inner}</Events></ArrangerAutomation></ClipTimeable></MainSequencer>
     </DeviceChain>
   </MidiTrack>`;

// A MIDI clip with the loop brace ON: playback starts at StartRelative and the brace spans the whole clip.
const midiClip = (
  start: number,
  end: number,
  loop: { on: boolean; start: number; end: number; rel: number },
  notes = "",
): string =>
  `<MidiClip Id="0" Time="${start}">
     <CurrentStart Value="${start}" /><CurrentEnd Value="${end}" />
     <Loop>
       <LoopStart Value="${loop.start}" /><LoopEnd Value="${loop.end}" />
       <StartRelative Value="${loop.rel}" /><LoopOn Value="${loop.on}" />
     </Loop>
     <Name Value="clip" />
     <Notes><KeyTracks>${notes}</KeyTracks></Notes>
   </MidiClip>`;

const audioTrack = (id: number, clips: string): string =>
  `<AudioTrack Id="${id}">
     <Name><EffectiveName Value="audio" /></Name>
     <DeviceChain>
       <Mixer><Speaker><Manual Value="true" /></Speaker></Mixer>
       <MainSequencer><Sample><ArrangerAutomation><Events>${clips}</Events></ArrangerAutomation></Sample></MainSequencer>
     </DeviceChain>
   </AudioTrack>`;

// Every sample found: these pin the clips' geometry, and a clip whose sample is missing is left out.
const clipsOf = (xml: string) => {
  const t = mapLiveSet(xml, "test", { readSample: () => new Uint8Array([0]) });
  return t.song.tracks.flatMap((tr) => tr.clips ?? []);
};

describe("a drum rack", () => {
  it("marks its track as DRUMS, so a stand-in kit can take its place", () => {
    const drums = midiTrack(1, "drums").replace(
      "<Mixer>",
      '<DeviceChain><Devices><DrumGroupDevice Id="0" /></Devices></DeviceChain><Mixer>',
    );
    const t = mapLiveSet(live(drums + midiTrack(2, "keys")), "test");
    expect(t.song.tracks.map((x) => !!x.drums)).toEqual([true, false]);
  });
});

describe("header", () => {
  it("reads tempo from MainTrack (Live 12's name for the master)", () => {
    expect(mapLiveSet(live(""), "test").song.project.tempo).toBe(110);
  });

  it("reads tempo from MasterTrack too (Live 11's name)", () => {
    const xml = live("").replace(/MainTrack/g, "MasterTrack");
    expect(mapLiveSet(xml, "test").song.project.tempo).toBe(110);
  });

  it("decodes the packed time signature integer", () => {
    // Live stores one int: 99 numerators per denominator, denominators being the powers of two.
    expect(decodeTimeSignature(201)).toBe("4/4");
    expect(decodeTimeSignature(200)).toBe("3/4");
    expect(decodeTimeSignature(102)).toBe("4/2");
    expect(decodeTimeSignature(302)).toBe("6/8");
    expect(mapLiveSet(live(""), "test").song.project.timeSignature).toBe("4/4");
  });

  it("refuses a version it cannot read, naming what it saw", () => {
    expect(() => mapLiveSet(live("", "10.0_10012"), "test")).toThrow(
      /unsupported Ableton version.*Live 10/,
    );
  });

  it("refuses a file that is not a Live set", () => {
    expect(() => mapLiveSet("<Project><Track/></Project>", "test")).toThrow(
      /no <Ableton> root/,
    );
  });
});

describe("track mixer", () => {
  it("inverts Speaker into mute — true means AUDIBLE in Live", () => {
    const on = mapLiveSet(live(midiTrack(1, "a")), "test").song.tracks[0];
    expect(on.mute).toBe(false);
    const off = mapLiveSet(
      live(
        midiTrack(1, "a").replace(
          'Speaker><Manual Value="true"',
          'Speaker><Manual Value="false"',
        ),
      ),
      "test",
    ).song.tracks[0];
    expect(off.mute).toBe(true);
  });

  it("converts pan from Live's -1..1 to the model's 0..1", () => {
    const t = mapLiveSet(live(midiTrack(1, "a")), "test").song.tracks[0];
    expect(t.pan).toBe(0); // hard left: -1 -> 0
    const centred = mapLiveSet(
      live(
        midiTrack(1, "a").replace(
          'Pan><Manual Value="-1"',
          'Pan><Manual Value="0"',
        ),
      ),
      "test",
    ).song.tracks[0];
    expect(centred.pan).toBe(0.5);
  });

  it("takes the track name from EffectiveName", () => {
    expect(
      mapLiveSet(live(midiTrack(7, "drums")), "test").song.tracks[0].name,
    ).toBe("drums");
  });
});

describe("MIDI notes", () => {
  // The pitch is on the KeyTrack, not on the event — the one structural surprise of Live's MIDI.
  const keyTrack = (key: number, events: string) =>
    `<KeyTrack Id="0"><Notes>${events}</Notes><MidiKey Value="${key}" /></KeyTrack>`;

  it("takes the pitch from the enclosing KeyTrack", () => {
    const xml = live(
      midiTrack(
        1,
        "a",
        midiClip(
          0,
          4,
          { on: true, start: 0, end: 4, rel: 0 },
          keyTrack(
            60,
            `<MidiNoteEvent Time="0" Duration="1" Velocity="127" OffVelocity="64" />
             <MidiNoteEvent Time="2" Duration="1" Velocity="64" OffVelocity="64" />`,
          ),
        ),
      ),
    );
    const notes = clipsOf(xml)[0].notes ?? [];
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.key)).toEqual([60, 60]);
    expect(notes[0].time).toBe(0);
    expect(notes[1].time).toBe(2);
  });

  it("scales velocity from 0..127 to 0..1", () => {
    const xml = live(
      midiTrack(
        1,
        "a",
        midiClip(
          0,
          4,
          { on: true, start: 0, end: 4, rel: 0 },
          keyTrack(
            60,
            `<MidiNoteEvent Time="0" Duration="1" Velocity="127" OffVelocity="0" />`,
          ),
        ),
      ),
    );
    const [note] = clipsOf(xml)[0].notes ?? [];
    expect(note.vel).toBe(1);
    expect(note.rel).toBe(0);
  });
});

describe("clip windows", () => {
  // <Loop> holds two different things by the brace; these cases are lifted from an actual arrangement.
  it("reads the material start from StartRelative when the loop is ON", () => {
    const xml = live(
      midiTrack(
        1,
        "a",
        midiClip(16, 24, { on: true, start: 0, end: 244, rel: 16 }),
      ),
    );
    const clip = clipsOf(xml)[0];
    expect(clip.start).toBe(16);
    expect(clip.offset).toBe(16);
    // The 0..244 brace must NOT become the window, or every note falls outside it.
    expect(materialWindow(clip)).toEqual({ from: 16, to: 24, loops: 1 });
  });

  it("reads it from LoopStart when the loop is OFF", () => {
    const xml = live(
      midiTrack(
        1,
        "a",
        midiClip(32, 40, { on: false, start: 8, end: 16, rel: 0 }),
      ),
    );
    const clip = clipsOf(xml)[0];
    expect(clip.start).toBe(32);
    expect(materialWindow(clip)).toEqual({ from: 8, to: 16, loops: 1 });
  });
});

describe("audio clips", () => {
  const audioClip = (attrs: {
    start: number;
    end: number;
    loopStart: number;
    loopEnd: number;
    warped: boolean;
    markers?: string;
  }) =>
    `<AudioClip Id="0" Time="${attrs.start}">
       <CurrentStart Value="${attrs.start}" /><CurrentEnd Value="${attrs.end}" />
       <Loop><LoopStart Value="${attrs.loopStart}" /><LoopEnd Value="${attrs.loopEnd}" />
             <StartRelative Value="0" /><LoopOn Value="false" /></Loop>
       <Name Value="take" />
       <SampleRef><FileRef><RelativePath Value="Samples/Imported/take.wav" />
         <Path Value="C:/elsewhere/take.wav" /><Name Value="take.wav" /></FileRef>
         <DefaultSampleRate Value="44100" /></SampleRef>
       <IsWarped Value="${attrs.warped}" />
       <WarpMarkers>${attrs.markers ?? ""}</WarpMarkers>
     </AudioClip>`;

  it("converts an UNWARPED region from seconds to beats", () => {
    // An unwarped region is in seconds: 52.363636s is 96 beats at 110bpm, so missing it is 1.83x off.
    const xml = live(
      audioTrack(
        1,
        audioClip({
          start: 96,
          end: 132,
          loopStart: 52.36363636363636,
          loopEnd: 72,
          warped: false,
        }),
      ),
    );
    const clip = clipsOf(xml)[0];
    expect(clip.offset).toBeCloseTo(96, 3);
    expect(materialWindow(clip).to).toBeCloseTo(132, 3);
  });

  it("leaves a WARPED region in beats", () => {
    const xml = live(
      audioTrack(
        1,
        audioClip({
          start: 16,
          end: 240,
          loopStart: 16,
          loopEnd: 240,
          warped: true,
          markers: `<WarpMarker Id="0" SecTime="0" BeatTime="0" />
                    <WarpMarker Id="1" SecTime="0.017045" BeatTime="0.03125" />`,
        }),
      ),
    );
    const clip = clipsOf(xml)[0];
    // Through the markers: 16 beats at 110 bpm, within what the fixture's rounded seconds allow.
    expect(clip.offset).toBeCloseTo(16, 2);
    // <WarpMarker BeatTime SecTime> lands as the model's [timeline beat, source second] pair.
    expect(clip.warp?.markers).toEqual([
      [0, 0],
      [0.03125, 0.017045],
    ]);
  });

  it("reads the in-point through the markers when the file's second 0 is not beat 0", () => {
    // A recording Live placed late on its grid: second 0 sits at clip beat 4, and the clip starts reading at beat 16.
    const xml = live(
      audioTrack(
        1,
        audioClip({
          start: 144,
          end: 184,
          loopStart: 16,
          loopEnd: 56,
          warped: true,
          markers: `<WarpMarker Id="0" SecTime="0" BeatTime="4" />
                    <WarpMarker Id="1" SecTime="0.017045454545" BeatTime="4.03125" />`,
        }),
      ),
    );
    // 12 beats into the FILE at 110 bpm, not 16: the four before second 0 are not in it.
    expect(clipsOf(xml)[0].offset).toBeCloseTo(12, 4);
  });

  it("drops a warp with fewer than two markers — one point defines no stretch", () => {
    const xml = live(
      audioTrack(
        1,
        audioClip({
          start: 0,
          end: 8,
          loopStart: 0,
          loopEnd: 8,
          warped: true,
          markers: `<WarpMarker Id="0" SecTime="0" BeatTime="0" />`,
        }),
      ),
    );
    expect(clipsOf(xml)[0].warp).toBeUndefined();
  });

  it("hands the caller both paths and keeps the bytes it returns", () => {
    const seen: string[] = [];
    const t = mapLiveSet(
      live(
        audioTrack(
          1,
          audioClip({
            start: 0,
            end: 8,
            loopStart: 0,
            loopEnd: 8,
            warped: true,
          }),
        ),
      ),
      "test",
      {
        readSample: (ref) => {
          seen.push(`${ref.name}|${ref.relative}|${ref.absolute}`);
          return new Uint8Array([1, 2, 3]);
        },
      },
    );
    expect(seen).toEqual([
      "take.wav|Samples/Imported/take.wav|C:/elsewhere/take.wav",
    ]);
    expect(t.song.tracks[0].clips?.[0].source).toBe("audio/take.wav");
    expect(t.files["audio/take.wav"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reports a sample the caller refused, and leaves its clip out rather than failing", () => {
    const t = mapLiveSet(
      live(
        audioTrack(
          1,
          audioClip({
            start: 0,
            end: 8,
            loopStart: 0,
            loopEnd: 8,
            warped: true,
          }),
        ),
      ),
      "test",
      { readSample: () => null },
    );
    // Placed on a file that is not there, the clip would make the whole song refuse to load.
    expect(t.song.tracks[0].clips ?? []).toHaveLength(0);
    expect(t.warnings).toContain(
      "sample not imported: Samples/Imported/take.wav — the clips playing it are left out",
    );
    expect(t.stats.audioClips).toBe(0);
  });

  it("leaves a TAKE LANE's clips out: they are takes the comp did not pick", () => {
    const clip = audioClip({
      start: 0,
      end: 8,
      loopStart: 0,
      loopEnd: 8,
      warped: true,
    });
    // Live 12 keeps every take beside the arrangement; its file need not even be in the project.
    const track = audioTrack(1, clip).replace(
      "</AudioTrack>",
      `<TakeLanes><TakeLanes><TakeLane Id="0"><ClipAutomation><Events>${clip}${clip}</Events></ClipAutomation></TakeLane></TakeLanes></TakeLanes></AudioTrack>`,
    );
    const t = mapLiveSet(live(track), "test", {
      readSample: () => new Uint8Array([0]),
    });
    expect(t.song.tracks[0].clips).toHaveLength(1);
    expect(t.warnings).toContain(
      "2 take-lane clip(s) ignored — only the takes comped into the Arrangement are imported",
    );
  });

  it("takes the project sample rate from the first sample", () => {
    const t = mapLiveSet(
      live(
        audioTrack(
          1,
          audioClip({
            start: 0,
            end: 8,
            loopStart: 0,
            loopEnd: 8,
            warped: true,
          }),
        ),
      ),
      "test",
    );
    expect(t.song.project.sampleRate).toBe(44100);
  });
});

describe("what is deliberately dropped", () => {
  it("counts Session view clips instead of importing them", () => {
    const sessionClip = `<MidiClip Id="9" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="4" />
      <Loop><LoopStart Value="0" /><LoopEnd Value="4" /><StartRelative Value="0" /><LoopOn Value="true" /></Loop></MidiClip>`;
    const xml = live(
      `<MidiTrack Id="1">
         <Name><EffectiveName Value="a" /></Name>
         <DeviceChain>
           <MainSequencer>
             <ClipTimeable><ArrangerAutomation><Events>${midiClip(0, 4, { on: true, start: 0, end: 4, rel: 0 })}</Events></ArrangerAutomation></ClipTimeable>
             <ClipSlotList><ClipSlot Id="0"><ClipSlot><Value>${sessionClip}</Value></ClipSlot></ClipSlot></ClipSlotList>
           </MainSequencer>
         </DeviceChain>
       </MidiTrack>`,
    );
    const t = mapLiveSet(xml, "test");
    expect(t.stats.midiClips).toBe(1); // only the arrangement one
    expect(t.warnings).toContain(
      "1 Session view clip(s) ignored — only the Arrangement is imported",
    );
  });

  it("names each return track it skips", () => {
    const xml = live(
      `${midiTrack(1, "a")}<ReturnTrack Id="2"><Name><EffectiveName Value="A-Reverb" /></Name></ReturnTrack>`,
    );
    expect(mapLiveSet(xml, "test").warnings).toContain(
      "1 return track(s) ignored — sends are not imported yet",
    );
  });
});

describe("plugins", () => {
  const vst2 = `<PluginDevice Id="0">
      <On><Manual Value="true" /></On>
      <PluginDesc><VstPluginInfo Id="0">
        <PlugName Value="Wurli V2" />
        <Preset><VstPreset Id="1"><Buffer>
          DEAD
          BEEF
        </Buffer></VstPreset></Preset>
      </VstPluginInfo></PluginDesc>
      <ParameterList>
        <PluginFloatParameter Id="0">
          <ParameterName Value="Drive" />
          <ParameterValue><Manual Value="0.25" /></ParameterValue>
        </PluginFloatParameter>
      </ParameterList>
    </PluginDevice>`;

  const withDevices = (devices: string) =>
    live(
      `<MidiTrack Id="1"><Name><EffectiveName Value="a" /></Name>
        <DeviceChain><DeviceChain><Devices>${devices}</Devices></DeviceChain></DeviceChain>
      </MidiTrack>`,
    );

  it("reads a VST2, decodes its whitespace-wrapped hex state, and seeds named params", () => {
    const t = mapLiveSet(withDevices(vst2), "test");
    const [p] = t.song.tracks[0].plugins ?? [];
    expect(p).toMatchObject({
      type: "vst2",
      name: "Wurli V2",
      enabled: true,
      role: "instrument",
    });
    // Live wraps and indents the hex; anything non-hex has to be stripped before decoding.
    expect(t.files[p.path ?? ""]).toEqual(
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    );
    expect(p.params).toEqual({ Drive: 0.25 });
    // Live only stores the automatable subset, so the opaque state can never be dropped.
    expect(p.paramsComplete).toBeUndefined();
  });

  it("finds a plugin nested inside a rack, and says the rack was flattened", () => {
    const t = mapLiveSet(
      withDevices(
        `<InstrumentGroupDevice Id="5"><Branches><InstrumentBranch><DeviceChain><Devices>${vst2}</Devices></DeviceChain></InstrumentBranch></Branches></InstrumentGroupDevice>`,
      ),
      "test",
    );
    expect((t.song.tracks[0].plugins ?? []).map((p) => p.name)).toEqual([
      "Wurli V2",
    ]);
    expect(t.warnings).toContain(
      'rack "InstrumentGroupDevice" flattened — the plugins inside are carried, its structure is not',
    );
  });

  it("names each native Ableton device it skips, but never the track's own mixer", () => {
    const t = mapLiveSet(
      withDevices(`<Eq8 Id="3"><On><Manual Value="true" /></On></Eq8>`),
      "test",
    );
    expect(t.song.tracks[0].plugins).toBeUndefined();
    expect(t.warnings).toContain(
      'Ableton device "Eq8" skipped — it has no portable form outside Live',
    );
    expect(t.warnings.join()).not.toMatch(/MixerDevice/);
  });
});
