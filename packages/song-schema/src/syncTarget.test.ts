import { describe, expect, it } from "vitest";
import {
  m3uName,
  m3uText,
  parseSyncTarget,
  safeUri,
  targetSegment,
  targetTrackPath,
} from "./syncTarget.ts";

describe("reading a target URI", () => {
  it("takes a file:// path, the triple slash included", () => {
    expect(parseSyncTarget("file:///media/usb/MUSIC")).toEqual({
      scheme: "file",
      root: "/media/usb/MUSIC",
    });
  });

  it("un-percent-encodes, since a mount point may carry a space", () => {
    expect(parseSyncTarget("file:///media/Cl%C3%A9%20USB")?.root).toBe(
      "/media/Clé USB",
    );
  });

  it("drops the URI's leading slash on a Windows drive letter", () => {
    // `file:///C:/Music` is the legal spelling; the path itself starts at the letter.
    expect(parseSyncTarget("file:///C:/Music")?.root).toBe("C:/Music");
  });

  it("takes an ftp:// host, with the credentials when they are there", () => {
    expect(parseSyncTarget("ftp://dj:s3cret@box.lan:2121/music")).toEqual({
      scheme: "ftp",
      host: "box.lan",
      port: 2121,
      user: "dj",
      password: "s3cret",
      root: "music",
    });
  });

  it("reads an ftp:// with no path as the login's own folder", () => {
    expect(parseSyncTarget("ftp://box.lan")?.root).toBe("");
  });

  it("refuses everything that is not one of the two schemes", () => {
    // `sftp` is a DIFFERENT protocol, and http would silently copy nothing.
    for (const bad of [
      "sftp://box.lan/music",
      "http://box.lan/music",
      "smb://nas/music",
      "not a uri",
      "",
      // A file URI naming a host is somebody else's disk, which this cannot write to.
      "file://otherbox/music",
      // Nothing to copy INTO.
      "file:///",
    ])
      expect(parseSyncTarget(bad)).toBeNull();
  });

  it("keeps a file:// on localhost, which is the legal spelling of ours", () => {
    expect(parseSyncTarget("file://localhost/media/usb")?.root).toBe(
      "/media/usb",
    );
  });
});

describe("showing one", () => {
  it("blanks the password and leaves everything else legible", () => {
    expect(safeUri("ftp://dj:s3cret@box.lan/music")).toBe(
      "ftp://dj:***@box.lan/music",
    );
    expect(safeUri("file:///media/usb")).toBe("file:///media/usb");
  });
});

describe("laying a track out", () => {
  it("is [artist]/[album]/[title] with the master's own extension", () => {
    expect(
      targetTrackPath({
        artist: "AC-DC",
        album: "Back in Black",
        title: "Hells Bells",
        ext: ".mp3",
      }),
    ).toBe("AC-DC/Back in Black/Hells Bells.mp3");
  });

  it("drops what a FAT volume cannot hold, a stick being what this is for", () => {
    expect(
      targetTrackPath({
        artist: "AC/DC",
        album: 'What: "Live"?',
        title: "Song|Two",
        ext: ".flac",
      }),
      // The runs of replaced characters collapse to ONE space, not one space each.
    ).toBe("AC DC/What Live/Song Two.flac");
  });

  it("never writes an empty segment, which would collapse the tree", () => {
    expect(
      targetTrackPath({ artist: "", album: "   ", title: "", ext: ".wav" }),
    ).toBe("Unknown Artist/Unknown Album/Untitled.wav");
  });

  it("refuses a trailing dot, legal to write and unopenable afterwards", () => {
    expect(targetSegment("Album.")).toBe("Album");
  });
});

describe("the m3u", () => {
  it("names each track relative to the playlists folder it sits in", () => {
    // The file lives at `playlists/x.m3u`, so every path climbs out of that folder first.
    expect(m3uText("été 2026", ["AC-DC/Back in Black/Hells Bells.mp3"])).toBe(
      "#EXTM3U\r\n# été 2026\r\n../AC-DC/Back in Black/Hells Bells.mp3\r\n",
    );
  });

  it("is flat, so a playlist filed under a folder keeps only its leaf", () => {
    expect(m3uName("live/répét")).toBe("répét.m3u");
    expect(m3uName("ete-2026")).toBe("ete-2026.m3u");
  });
});
