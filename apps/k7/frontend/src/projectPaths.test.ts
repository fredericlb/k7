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
  projectDir,
  rackKeyOf,
  toProjectRelative,
} from "./projectPaths";
import { readScalarField } from "./scalarField";

// The reported bug: the gutter ▶ on a migrated rack sent a bare filename, and the backend resolved it against the project root.

describe("which kind of file a path is", () => {
  it("recognises a rack module", () => {
    expect(isRackModuleFile("modules/instruments/drum_1/module.k7x")).toBe(
      true,
    );
  });

  it("recognises one behind a project prefix, with backslashes", () => {
    // What the file tree actually hands over on Windows in a multi-project workspace.
    expect(
      isRackModuleFile(
        "LEMO - DANSE\\modules\\instruments\\drum_1\\module.k7x",
      ),
    ).toBe(true);
  });

  it("is not fooled by a module NODE file", () => {
    // `bass.k7x` beside `module.k7x` is a node; only the generic file is the rack.
    expect(isRackModuleFile("modules/audio/amp/bass.k7x")).toBe(false);
  });

  it("recognises sequences, clips, tracks and video tracks", () => {
    expect(isSeqFile("sequences/lead.k7x")).toBe(true);
    expect(isClipFile("clips/kick.k7x")).toBe(true);
    // A lane lives in `nodes/` — it is a node of a `@meta/…-track` module — or a chain project's `tracks/`.
    expect(isTrackFile("nodes/melody.k7x")).toBe(true);
    expect(isTrackFile("tracks/melody.k7x")).toBe(true);
    expect(isTrackFile("video_tracks/melody.k7x")).toBe(false);
    expect(isTrackFile("chains/melody.k7x")).toBe(false);
    // A picture lane is a lane file too, told apart by its name being one of the song's picture lanes.
    expect(isVideoTrackFile("nodes/cam.k7x", ["cam"])).toBe(true);
    expect(isVideoTrackFile("tracks/cam.k7x", ["cam"])).toBe(true);
    expect(isVideoTrackFile("nodes/melody.k7x", ["cam"])).toBe(false);
  });

  it("says no to a folder that merely looks similar", () => {
    expect(isClipFile("clips/nested/kick.k7x")).toBe(false);
    expect(isSeqFile("sequences.k7x")).toBe(false);
    expect(isTrackFile("nodes/melody.wav")).toBe(false);
  });

  it("takes the id off the extension, keeping a dot inside the name", () => {
    expect(fileStem("clips/kick.k7x")).toBe("kick");
    expect(fileStem("a\\b\\my.clip.k7x")).toBe("my.clip");
  });

  it("finds the generic module file beside a node", () => {
    expect(moduleFileOf("modules/audio/amp/bass.k7x")).toBe(
      "modules/audio/amp/module.k7x",
    );
  });
});

describe("reading a scalar field out of a file's text", () => {
  it("reads a call's string value", () => {
    expect(readScalarField('source("md-shots_norm.wav")\n', "source")).toBe(
      "md-shots_norm.wav",
    );
  });

  it("reads one inside an object, in either quotes", () => {
    expect(
      readScalarField('rack({ source: "break.wav", note: 36 })', "source"),
    ).toBe("break.wav");
    expect(readScalarField("rack({ source: 'a b.wav' })", "source")).toBe(
      "a b.wav",
    );
  });

  it("reads its escapes", () => {
    expect(readScalarField('name("say \\"hi\\"")\n', "name")).toBe('say "hi"');
  });

  it("reads it while the rest of the file does not parse", () => {
    // Mid-keystroke: the popin's module beside an instance must not vanish because another line is half-typed.
    expect(readScalarField('extends("audio/amp")\nparams({\n', "extends")).toBe(
      "audio/amp",
    );
  });

  it("ignores a trailing comment", () => {
    expect(
      readScalarField('source("kick.wav") // the good one\n', "source"),
    ).toBe("kick.wav");
  });

  it("doesn't match a key that merely ends with the one asked for", () => {
    expect(readScalarField('use_rack("drums")\n', "rack")).toBe(null);
  });

  it("returns null for an absent, empty or non-string field", () => {
    expect(readScalarField("note(36)\n", "source")).toBe(null);
    expect(readScalarField('source("")\n', "source")).toBe(null);
    expect(readScalarField("source(3)\n", "source")).toBe(null);
  });
});

describe("entityFile", () => {
  const files = [
    "tracks/kick.k7x",
    "clips/kick.k7x",
    "tracks/ge.lead.k7x",
    "video_tracks/cam1.k7x",
  ];

  it("takes the file in the folder asked for, not the one that merely shares the id", () => {
    expect(entityFile(files, "tracks", "kick")).toBe("tracks/kick.k7x");
    expect(entityFile(files, "clips", "kick")).toBe("clips/kick.k7x");
  });

  it("finds an id holding a dot, and never a .yaml file", () => {
    expect(entityFile(files, "tracks", "ge.lead")).toBe("tracks/ge.lead.k7x");
    expect(entityFile(["tracks/snare.yaml"], "tracks", "snare")).toBe(null);
  });

  it("finds it under a project-folder prefix", () => {
    expect(
      entityFile(["band/winter.k7/tracks/kick.k7x"], "tracks", "kick"),
    ).toBe("band/winter.k7/tracks/kick.k7x");
  });

  it("does not let an id's dots stand for any character", () => {
    // The pattern is built by interpolation, so `ge.lead` must not also match `geXlead`.
    expect(entityFile(["tracks/geXlead.k7x"], "tracks", "ge.lead")).toBe(null);
  });

  it("returns null when the song has no such file", () => {
    expect(entityFile(files, "tracks", "snare")).toBe(null);
  });
});

describe("rackKeyOf", () => {
  // The key `hints.racks` files a rack under: a module's folder name, or a NODE's stem, the hint folding `extends` in under it.
  it("answers a module's folder name, filing included", () => {
    expect(rackKeyOf("modules/instruments/drum_1/module.k7x")).toBe("drum_1");
    expect(rackKeyOf("song.k7/modules/instruments/drum_1/module.k7x")).toBe(
      "drum_1",
    );
  });

  it("answers a node's stem — the instance of a rack is a rack too", () => {
    expect(rackKeyOf("nodes/da_main-drum_1.k7x")).toBe("da_main-drum_1");
    expect(rackKeyOf("song.k7/nodes/da_main-drum_1.k7x")).toBe(
      "da_main-drum_1",
    );
  });

  it("answers nothing for every other file", () => {
    expect(rackKeyOf("clips/kick.k7x")).toBe(null);
    // A chain file holds many nodes, so its path answers for none of them.
    expect(rackKeyOf("chains/da.main.k7x")).toBe(null);
    expect(rackKeyOf("modules/instruments/drum_1/panel.k7x")).toBe(null);
  });
});

// The tree is the whole workspace now, so "is this file the open project's?" became a question.
describe("inActiveProject", () => {
  it("keeps a file of another project out", () => {
    expect(inActiveProject("song.k7/clips/a.k7x", "song.k7")).toBe(true);
    expect(inActiveProject("other.k7/clips/a.k7x", "song.k7")).toBe(false);
    // Not a prefix match on the STRING: `song.k7-old` is a different folder.
    expect(inActiveProject("song.k7-old/clips/a.k7x", "song.k7")).toBe(false);
  });

  it("lets everything through when the workspace IS the project", () => {
    expect(inActiveProject("clips/a.k7x", ".")).toBe(true);
  });

  it("lets nothing through when no project is open", () => {
    expect(inActiveProject("song.k7/clips/a.k7x", null)).toBe(false);
  });

  it("reads a windows path like every other rule here", () => {
    expect(inActiveProject("song.k7\\clips\\a.k7x", "song.k7")).toBe(true);
  });
});

describe("a .yaml file is no workspace file", () => {
  it("is recognised as no kind", () => {
    expect(isSeqFile("song/sequences/melody.yaml")).toBe(false);
    expect(isClipFile("song/clips/kick.yaml")).toBe(false);
    expect(isRackModuleFile("modules/instruments/drum_1/module.yaml")).toBe(
      false,
    );
  });
});

describe("projectDir / toProjectRelative", () => {
  it("slashes the folder, drops a trailing slash, and reads `.` as none", () => {
    expect(projectDir("songs\\first.k7\\")).toBe("songs/first.k7");
    expect(projectDir(".")).toBe("");
    expect(projectDir(null)).toBe("");
  });
  it("strips the project prefix and leaves any other path slashed", () => {
    expect(toProjectRelative("a.k7\\clips\\x.k7x", "a.k7")).toBe("clips/x.k7x");
    expect(toProjectRelative("a.k7x/clips/x.k7x", "a.k7")).toBe(
      "a.k7x/clips/x.k7x",
    );
    expect(toProjectRelative("clips/x.k7x", ".")).toBe("clips/x.k7x");
  });
});
