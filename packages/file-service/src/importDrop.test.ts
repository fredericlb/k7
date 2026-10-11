// A foreign project DROPPED on a workspace: bytes in, a folder somebody named out. Through
// `importProjectBytes`, which is what the home page's drop reaches and the only import that never
// writes the source file into the workspace.
//
// It carries this repo's first `.dawproject` fixture — built here rather than committed, because a
// zip in git is a binary nobody can read a diff of. See packages/translator/docs/import.md.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { gzipSync, strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DROPPABLE,
  importProjectBytes,
  type LifecycleHost,
} from "./projectLifecycle.ts";

let root: string;

/** The path guards a workspace gives the lifecycle functions, over a temp folder. */
const host = (): LifecycleHost => ({
  root,
  safePath: (rel: string) => {
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + "/") && !abs.startsWith(root))
      throw new Error(`outside the workspace: ${rel}`);
    return abs;
  },
  toRel: (abs: string) => relative(root, abs).split("\\").join("/"),
});

/** The smallest `.dawproject` that says something: a tempo, a time signature and one named track. */
function dawproject(title = "Winter", tempo = 128): Uint8Array {
  const projectXml = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0">
  <Transport>
    <Tempo value="${tempo}" unit="bpm" />
    <TimeSignature numerator="3" denominator="4" />
  </Transport>
  <Structure>
    <Track id="t1" name="Bass" contentType="notes">
      <Channel id="c1" role="regular" />
    </Track>
  </Structure>
</Project>`;
  const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<MetaData><Title>${title}</Title></MetaData>`;
  const enc = new TextEncoder();
  return zipSync({
    "project.xml": enc.encode(projectXml),
    "metadata.xml": enc.encode(metadata),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fs-drop-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a project dropped on a workspace", () => {
  it("lands in the folder the popin named, not in the file's own", () => {
    const { project, log } = importProjectBytes(
      host(),
      "Winter Sketch.dawproject",
      dawproject(),
      "hiver.st0",
    );
    expect(project).toBe("hiver.st0");
    expect(existsSync(join(root, "hiver.st0", "project.yaml"))).toBe(true);
    // …and the log names what it read, which is a FILE here and not a path in the workspace.
    expect(log[0]).toBe("read Winter Sketch.dawproject");
    expect(log.at(-1)).toBe("wrote hiver.st0");
  });

  it("translates a ZIPPED Ableton project, its set past Live's backups and its sample inside", () => {
    const set = gzipSync(
      strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.0">
  <LiveSet>
    <MainTrack><DeviceChain><Mixer>
      <Tempo><Manual Value="97" /></Tempo>
      <TimeSignature><Manual Value="201" /></TimeSignature>
    </Mixer></DeviceChain></MainTrack>
    <Tracks>
      <AudioTrack Id="1">
        <Name><EffectiveName Value="Guitar" /></Name>
        <DeviceChain>
          <Mixer><Speaker><Manual Value="true" /></Speaker></Mixer>
          <MainSequencer><Sample><ArrangerAutomation><Events>
            <AudioClip Id="0" Time="0">
              <CurrentStart Value="0" /><CurrentEnd Value="8" />
              <Loop><LoopStart Value="0" /><LoopEnd Value="8" />
                    <StartRelative Value="0" /><LoopOn Value="false" /></Loop>
              <Name Value="take" />
              <SampleRef><FileRef><RelativePath Value="Samples/Imported/take.wav" />
                <Name Value="take.wav" /></FileRef></SampleRef>
              <IsWarped Value="true" /><WarpMarkers></WarpMarkers>
            </AudioClip>
          </Events></ArrangerAutomation></Sample></MainSequencer>
        </DeviceChain>
      </AudioTrack>
    </Tracks>
  </LiveSet>
</Ableton>`),
    );
    const zip = zipSync({
      "Hiver Project/Hiver.als": set,
      "Hiver Project/Backup/Hiver [2024].als": set,
      "Hiver Project/Samples/Imported/take.wav": new Uint8Array([1, 2, 3]),
    });
    const { project, log } = importProjectBytes(
      host(),
      "Hiver Project.zip",
      zip,
      "hiver.st0",
    );
    expect(project).toBe("hiver.st0");
    expect(log[1]).toContain("97 bpm");
    expect(log.join(" ")).not.toContain("sample not imported");
  });

  it("leaves the dropped file nowhere: the project is all that lands", () => {
    importProjectBytes(host(), "winter.dawproject", dawproject(), "hiver.st0");
    expect(existsSync(join(root, "winter.dawproject"))).toBe(false);
  });

  it("reads the header a mapper is judged on", () => {
    const { log } = importProjectBytes(
      host(),
      "winter.dawproject",
      dawproject("Hiver", 92),
      "hiver.st0",
    );
    // The title comes from metadata.xml and beats the filename; the tempo and signature from Transport.
    expect(log[1]).toContain('project "Hiver"');
    expect(log[1]).toContain("92 bpm");
    expect(log[1]).toContain("3/4");
  });

  it("refuses a name already taken, rather than quietly picking another", () => {
    const bytes = dawproject();
    importProjectBytes(host(), "winter.dawproject", bytes, "hiver.st0");
    // A name somebody TYPED is never changed under them — `project new` refuses the same way.
    expect(() =>
      importProjectBytes(host(), "winter.dawproject", bytes, "hiver.st0"),
    ).toThrow(/already exists/);
  });

  it("refuses a format that cannot travel alone, and says where to import it", () => {
    // A `.als` names its samples by path: dropped on its own it would import a silent project.
    expect(() =>
      importProjectBytes(host(), "winter.als", dawproject(), "hiver.st0"),
    ).toThrow(/\.dawproject/);
    expect(() =>
      importProjectBytes(host(), "winter.als", dawproject(), "hiver.st0"),
    ).toThrow(/from the tree/);
    // …while a zipped Ableton project carries its samples, so it may be dropped.
    expect(DROPPABLE).toEqual([".dawproject", ".zip"]);
  });

  it("refuses bytes that are not the format they claim", () => {
    expect(() =>
      importProjectBytes(
        host(),
        "winter.dawproject",
        new TextEncoder().encode("not a zip"),
        "hiver.st0",
      ),
    ).toThrow();
    // …and writes nothing on the way out: a failed import leaves no half-folder behind.
    expect(existsSync(join(root, "hiver.st0"))).toBe(false);
  });

  it("writes into a folder that is there and EMPTY, which is not 'in use'", () => {
    mkdirSync(join(root, "hiver.st0"), { recursive: true });
    // An EMPTY folder is not "in use": the import writes into it, exactly as a scaffold would.
    expect(() =>
      importProjectBytes(
        host(),
        "winter.dawproject",
        dawproject(),
        "hiver.st0",
      ),
    ).not.toThrow();
  });
});
