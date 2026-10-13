import { describe, expect, it } from "vitest";
import {
  entityFile,
  fileStem,
  inActiveProject,
  isClipFile,
  isRackModuleFile,
  isSeqFile,
  isTrackFile,
  isVideoTrackFile,
  moduleFileOf,
  rackKeyOf,
  readScalarField,
} from "./projectPaths";

// The reported bug: the gutter ▶ on a migrated rack sent a bare filename, and the backend resolved it against the project root.

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

  it("is not fooled by a module NODE file", () => {
    // `bass.yaml` beside `module.yaml` is a node; only the generic file is the rack.
    expect(isRackModuleFile("modules/audio/amp/bass.yaml")).toBe(false);
  });

  it("recognises sequences, clips, tracks and video tracks", () => {
    expect(isSeqFile("sequences/lead.yaml")).toBe(true);
    expect(isClipFile("clips/kick.yaml")).toBe(true);
    // A lane lives in `nodes/` — it is a node of a `@meta/…-track` module — or a chain project's `tracks/`.
    expect(isTrackFile("nodes/melody.yaml")).toBe(true);
    expect(isTrackFile("tracks/melody.yaml")).toBe(true);
    expect(isTrackFile("video_tracks/melody.yaml")).toBe(false);
    expect(isTrackFile("chains/melody.yaml")).toBe(false);
    expect(isVideoTrackFile("video_tracks/cam.yaml")).toBe(true);
  });

  it("says no to a folder that merely looks similar", () => {
    expect(isClipFile("clips/nested/kick.yaml")).toBe(false);
    expect(isSeqFile("sequences.yaml")).toBe(false);
    expect(isTrackFile("nodes/melody.wav")).toBe(false);
  });

  it("takes the id off the extension, keeping a dot inside the name", () => {
    expect(fileStem("clips/kick.yaml")).toBe("kick");
    expect(fileStem("a\\b\\my.clip.yml")).toBe("my.clip");
  });

  it("finds the generic module file beside a node", () => {
    expect(moduleFileOf("modules/audio/amp/bass.yaml")).toBe(
      "modules/audio/amp/module.yaml",
    );
  });
});

describe("reading a scalar field out of a file's text", () => {
  it("reads an unquoted scalar", () => {
    // The one that was silently returning null: CUE always quotes and YAML usually does not, so a quote-demanding regex saw no source.
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

describe("entityFile", () => {
  const files = [
    "tracks/kick.yaml",
    "clips/kick.yaml",
    "tracks/ge.lead.yml",
    "video_tracks/cam1.yaml",
  ];

  it("takes the file in the folder asked for, not the one that merely shares the id", () => {
    expect(entityFile(files, "tracks", "kick")).toBe("tracks/kick.yaml");
    expect(entityFile(files, "clips", "kick")).toBe("clips/kick.yaml");
  });

  it("accepts either spelling of the extension", () => {
    expect(entityFile(files, "tracks", "ge.lead")).toBe("tracks/ge.lead.yml");
  });

  it("finds it under a project-folder prefix", () => {
    expect(
      entityFile(["band/winter.st0/tracks/kick.yaml"], "tracks", "kick"),
    ).toBe("band/winter.st0/tracks/kick.yaml");
  });

  it("does not let an id's dots stand for any character", () => {
    // The pattern is built by interpolation, so `ge.lead` must not also match `geXlead`.
    expect(entityFile(["tracks/geXlead.yaml"], "tracks", "ge.lead")).toBe(null);
  });

  it("returns null when the song has no such file", () => {
    expect(entityFile(files, "tracks", "snare")).toBe(null);
  });
});

describe("rackKeyOf", () => {
  // The key `hints.racks` files a rack under: a module's folder name, or a NODE's stem, the hint folding `extends` in under it.
  it("answers a module's folder name, filing included", () => {
    expect(rackKeyOf("modules/instruments/drum_1/module.yaml")).toBe("drum_1");
    expect(rackKeyOf("song.st0/modules/instruments/drum_1/module.yml")).toBe(
      "drum_1",
    );
  });

  it("answers a node's stem — the instance of a rack is a rack too", () => {
    expect(rackKeyOf("nodes/da_main-drum_1.yaml")).toBe("da_main-drum_1");
    expect(rackKeyOf("song.st0/nodes/da_main-drum_1.yaml")).toBe(
      "da_main-drum_1",
    );
  });

  it("answers nothing for every other file", () => {
    expect(rackKeyOf("clips/kick.yaml")).toBe(null);
    // A chain file holds many nodes, so its path answers for none of them.
    expect(rackKeyOf("chains/da.main.yaml")).toBe(null);
    expect(rackKeyOf("modules/instruments/drum_1/panel.yaml")).toBe(null);
  });
});

// The tree is the whole workspace now, so "is this file the open project's?" became a question.
describe("inActiveProject", () => {
  it("keeps a file of another project out", () => {
    expect(inActiveProject("song.st0/clips/a.yaml", "song.st0")).toBe(true);
    expect(inActiveProject("other.st0/clips/a.yaml", "song.st0")).toBe(false);
    // Not a prefix match on the STRING: `song.st0-old` is a different folder.
    expect(inActiveProject("song.st0-old/clips/a.yaml", "song.st0")).toBe(
      false,
    );
  });

  it("lets everything through when the workspace IS the project", () => {
    expect(inActiveProject("clips/a.yaml", ".")).toBe(true);
  });

  it("lets nothing through when no project is open", () => {
    expect(inActiveProject("song.st0/clips/a.yaml", null)).toBe(false);
  });

  it("reads a windows path like every other rule here", () => {
    expect(inActiveProject("song.st0\\clips\\a.yaml", "song.st0")).toBe(true);
  });
});

describe("a .k7x file is the same kind of file as its YAML spelling", () => {
  it("is recognised by kind", () => {
    expect(isSeqFile("song/sequences/melody.k7x")).toBe(true);
    expect(isClipFile("song/clips/kick.k7x")).toBe(true);
    expect(isRackModuleFile("modules/instruments/drum_1/module.k7x")).toBe(
      true,
    );
  });

  it("names the same id and the same module file", () => {
    expect(fileStem("song/nodes/lead.k7x")).toBe("lead");
    expect(moduleFileOf("_modules/audio/amp/lead.k7x")).toBe(
      "_modules/audio/amp/module.yaml",
    );
  });
});
