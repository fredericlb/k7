// A zipped Ableton project: the set is found past Live's backups, and its samples are read from inside the zip.

import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseAlsZip, pickSet } from "./abletonZip";

const als = (relative: string): Uint8Array =>
  gzipSync(
    strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.0">
  <LiveSet>
    <MainTrack><DeviceChain><Mixer>
      <Tempo><Manual Value="110" /></Tempo>
      <TimeSignature><Manual Value="201" /></TimeSignature>
    </Mixer></DeviceChain></MainTrack>
    <Tracks>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="audio" /></Name>
        <DeviceChain>
          <Mixer><Speaker><Manual Value="true" /></Speaker></Mixer>
          <MainSequencer><Sample><ArrangerAutomation><Events>
            <AudioClip Id="0" Time="0">
              <CurrentStart Value="0" /><CurrentEnd Value="8" />
              <Loop><LoopStart Value="0" /><LoopEnd Value="8" />
                    <StartRelative Value="0" /><LoopOn Value="false" /></Loop>
              <Name Value="take" />
              <SampleRef><FileRef><RelativePath Value="${relative}" />
                <Path Value="C:/elsewhere/take.wav" /><Name Value="take.wav" /></FileRef>
                <DefaultSampleRate Value="44100" /></SampleRef>
              <IsWarped Value="true" />
              <WarpMarkers></WarpMarkers>
            </AudioClip>
          </Events></ArrangerAutomation></Sample></MainSequencer>
        </DeviceChain>
      </AudioTrack>
    </Tracks>
  </LiveSet>
</Ableton>`),
  );

const WAV = new Uint8Array([1, 2, 3]);

describe("the set a zip holds", () => {
  it("is the one outside Backup/, whatever Live and a Mac left beside it", () => {
    expect(
      pickSet([
        "Song Project/Backup/Song [2024-01-01].als",
        "__MACOSX/Song Project/._Song.als",
        "Song Project/Song.als",
      ]),
    ).toBe("Song Project/Song.als");
  });

  it("refuses a zip with none, and one with two side by side", () => {
    expect(() => pickSet(["a.wav"])).toThrow(/no Ableton set/);
    expect(() => pickSet(["a.als", "b.als"])).toThrow(/2 Ableton sets/);
  });
});

describe("parseAlsZip", () => {
  it("reads a sample where the set says, relative to the set's own folder", () => {
    const zip = zipSync({
      "Song Project/Song.als": als("Samples/Imported/take.wav"),
      "Song Project/Samples/Imported/take.wav": WAV,
      "Song Project/Backup/Song [old].als": als("nope.wav"),
    });
    const t = parseAlsZip(zip, "dropped");
    expect(t.set).toBe("Song Project/Song.als");
    expect(t.files["audio/take.wav"]).toEqual(WAV);
    expect(t.warnings.join(" ")).not.toContain("sample not imported");
  });

  it("finds a sample by its NAME when the relative path does not match", () => {
    const zip = zipSync({
      "Song.als": als("../Somewhere/else/take.wav"),
      "Samples/Recorded/take.wav": WAV,
    });
    expect(parseAlsZip(zip, "dropped").files["audio/take.wav"]).toEqual(WAV);
  });

  it("says plainly when the bytes are not a zip", () => {
    expect(() => parseAlsZip(new Uint8Array([1, 2, 3, 4]), "x")).toThrow(
      /not a zip/,
    );
  });
});
