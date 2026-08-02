import { describe, expect, it } from "vitest";
import {
  fileStem,
  isClipFile,
  isRackModuleFile,
  isSeqFile,
  isTrackFile,
  isVideoTrackFile,
  moduleFileOf,
  readScalarField,
} from "./projectPaths";

// The reported bug, exactly: the gutter ▶ on a migrated rack sent a bare filename, the
// backend resolved it against the project root, and the user got
// `ENOENT … LEMO - DANSE\md-shots_norm.wav` for a file sitting in the module's own folder.

describe("which kind of file a path is", () => {
  it("recognises a rack module", () => {
    expect(isRackModuleFile("modules/instruments/drum_1/module.yaml")).toBe(
      true,
    );
    expect(isRackModuleFile("modules/instruments/drum_1/module.yml")).toBe(
      true,
    );
  });

  it("recognises one behind a project prefix, with backslashes", () => {
    // What the file tree actually hands over on Windows in a multi-project workspace.
    expect(
      isRackModuleFile(
        "LEMO - DANSE\\modules\\instruments\\drum_1\\module.yaml",
      ),
    ).toBe(true);
  });

  it("is not fooled by a module INSTANCE file", () => {
    // `bass.yaml` beside `module.yaml` is an instance; only the generic file is the rack.
    expect(isRackModuleFile("modules/audio/amp/bass.yaml")).toBe(false);
  });

  it("recognises sequences, clips, tracks and video tracks", () => {
    expect(isSeqFile("sequences/lead.yaml")).toBe(true);
    expect(isClipFile("clips/kick.yaml")).toBe(true);
    expect(isTrackFile("tracks/melody.yaml")).toBe(true);
    expect(isVideoTrackFile("video_tracks/cam.yaml")).toBe(true);
  });

  it("says no to a folder that merely looks similar", () => {
    expect(isClipFile("clips/nested/kick.yaml")).toBe(false);
    expect(isSeqFile("sequences.yaml")).toBe(false);
    expect(isTrackFile("tracks/melody.wav")).toBe(false);
  });

  it("takes the id off the extension, keeping a dot inside the name", () => {
    expect(fileStem("clips/kick.yaml")).toBe("kick");
    expect(fileStem("a\\b\\my.clip.yml")).toBe("my.clip");
  });

  it("finds the generic module file beside an instance", () => {
    expect(moduleFileOf("modules/audio/amp/bass.yaml")).toBe(
      "modules/audio/amp/module.yaml",
    );
  });
});

describe("reading a scalar field out of a file's text", () => {
  it("reads an unquoted scalar", () => {
    // The one that was silently returning null: CUE always quotes, YAML usually doesn't, so
    // a quote-demanding regex read every migrated clip as having no source at all.
    expect(readScalarField("source: md-shots_norm.wav\n", "source")).toBe(
      "md-shots_norm.wav",
    );
  });

  it("reads a quoted one, inside a flow mapping", () => {
    expect(
      readScalarField('rack: { source: "break.wav", note: 36 }', "source"),
    ).toBe("break.wav");
  });

  it("keeps a value that needed its quotes", () => {
    expect(readScalarField('name: "2:1"\n', "name")).toBe("2:1");
  });

  it("drops a trailing comment", () => {
    expect(readScalarField("source: kick.wav # the good one\n", "source")).toBe(
      "kick.wav",
    );
    expect(readScalarField('source: "kick.wav" // ditto\n', "source")).toBe(
      "kick.wav",
    );
  });

  it("doesn't match a key that merely ends with the one asked for", () => {
    expect(readScalarField("use_rack: drums\n", "rack")).toBe(null);
  });

  it("returns null for an absent or empty field", () => {
    expect(readScalarField("note: 36\n", "source")).toBe(null);
    expect(readScalarField("source:\n", "source")).toBe(null);
  });
});
