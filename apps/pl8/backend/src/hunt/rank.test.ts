import { describe, expect, it } from "vitest";
import {
  artistMatches,
  bitrateOf,
  classify,
  normalise,
  qualityOf,
  rankCandidates,
  type SlskdResponse,
  titleMatches,
  tokens,
} from "./rank.ts";

const file = (filename: string, extra: Record<string, unknown> = {}) => ({
  filename,
  size: 8_000_000,
  ...extra,
});

describe("normalise", () => {
  it("brings two spellings of one name to the same string", () => {
    // The whole point: MusicBrainz says "AC/DC", the person sharing typed "AC-DC".
    expect(normalise("AC/DC")).toBe("ac dc");
    expect(normalise("AC-DC")).toBe("ac dc");
    expect(normalise("ac_dc")).toBe("ac dc");
    expect(normalise("Björk")).toBe("bjork");
    expect(normalise("Simon & Garfunkel")).toBe("simon garfunkel");
  });
});

describe("tokens", () => {
  it("drops the noise words that only half the network writes", () => {
    expect(tokens("The Beatles")).toEqual(["beatles"]);
    expect(tokens("Los Lobos")).toEqual(["lobos"]);
  });
});

describe("artistMatches", () => {
  it("finds the artist in a parent folder, whatever the separators", () => {
    expect(
      artistMatches(
        "AC/DC",
        "@bob\\Music\\AC-DC\\Back in Black\\02 Hells Bells.mp3",
      ),
    ).toBe(true);
    expect(
      artistMatches(
        "Nirvana",
        "@ann\\shared\\nirvana\\nevermind\\05 lithium.flac",
      ),
    ).toBe(true);
  });

  it("matches whole words, so one band is not taken for another", () => {
    // `includes("air")` would hand every Airbourne file to a search for Air.
    expect(
      artistMatches("Air", "@bob\\Music\\Airbourne\\Runnin' Wild\\01 x.mp3"),
    ).toBe(false);
    expect(
      artistMatches("Air", "@bob\\Music\\Air\\Moon Safari\\01 La femme.mp3"),
    ).toBe(true);
  });

  it("does not accept everything for an artist made only of noise words", () => {
    // `every` on an empty token list is vacuously true — that would take the whole network.
    expect(artistMatches("The The", "@bob\\Music\\Nirvana\\x.mp3")).toBe(false);
    expect(
      artistMatches("The The", "@bob\\Music\\The The\\Soul Mining\\x.mp3"),
    ).toBe(true);
  });
});

describe("titleMatches", () => {
  it("reads the file name and not the album folder", () => {
    // Every track lives under a folder naming Lithium's album; only one of them is Lithium.
    const inLithiumsAlbum =
      "@ann\\Nirvana\\Nevermind - Lithium sessions\\04 Breed.mp3";
    expect(titleMatches("Lithium", inLithiumsAlbum)).toBe(false);
    expect(
      titleMatches("Lithium", "@ann\\Nirvana\\Nevermind\\05 Lithium.mp3"),
    ).toBe(true);
  });

  it("ignores the track number and the extension", () => {
    expect(titleMatches("So What", "@x\\Miles Davis\\01 - So What.flac")).toBe(
      true,
    );
  });
});

describe("bitrateOf", () => {
  it("takes the peer's figure when there is one", () => {
    expect(bitrateOf(file("a.mp3", { bitRate: 320 }))).toBe(320);
  });

  it("measures it from the bytes when there is not", () => {
    // The protocol makes bitRate optional and many clients omit it; 8 MB over 200 s is 320.
    expect(bitrateOf(file("a.mp3", { size: 8_000_000, length: 200 }))).toBe(
      320,
    );
  });

  it("is null when nothing can be told, rather than guessing a number", () => {
    expect(bitrateOf(file("a.mp3"))).toBeNull();
  });
});

describe("qualityOf", () => {
  it("orders the tiers the way the request asks", () => {
    const q = (f: string, extra = {}) => qualityOf(file(f, extra));
    expect(q("a.flac")).toBeGreaterThan(q("a.wav"));
    expect(q("a.wav")).toBeGreaterThan(q("a.mp3", { bitRate: 320 }));
    expect(q("a.mp3", { bitRate: 320 })).toBeGreaterThan(
      q("a.mp3", { bitRate: 256 }),
    );
    expect(q("a.mp3", { bitRate: 256 })).toBeGreaterThan(
      q("a.mp3", { bitRate: 128 }),
    );
  });

  it("puts an unmeasurable lossy file BELOW every known rate", () => {
    // Otherwise a file that said nothing about itself would outrank a measured 320.
    expect(qualityOf(file("a.mp3"))).toBeLessThan(
      qualityOf(file("a.mp3", { bitRate: 128 })),
    );
  });
});

describe("rankCandidates", () => {
  const want = { artist: "Nirvana", title: "Lithium" };

  it("keeps only the right artist and the right song", () => {
    const responses: SlskdResponse[] = [
      {
        username: "ann",
        files: [file("@ann\\Nirvana\\Nevermind\\05 Lithium.flac")],
      },
      {
        username: "bob",
        files: [file("@bob\\Pixies\\Doolittle\\01 Debaser.flac")],
      },
      {
        username: "cat",
        files: [file("@cat\\Nirvana\\Nevermind\\04 Breed.flac")],
      },
    ];
    expect(rankCandidates(responses, want).map((c) => c.username)).toEqual([
      "ann",
    ]);
  });

  it("refuses what the library could not file, even when it is lossless", () => {
    // `.ape` is all over Soulseek and `masterName` throws on it, so it cannot be put away.
    const responses: SlskdResponse[] = [
      {
        username: "ann",
        files: [file("@ann\\Nirvana\\Nevermind\\05 Lithium.ape")],
      },
      {
        username: "bob",
        files: [
          file("@bob\\Nirvana\\Nevermind\\05 Lithium.mp3", { bitRate: 128 }),
        ],
      },
    ];
    expect(rankCandidates(responses, want).map((c) => c.username)).toEqual([
      "bob",
    ]);
  });

  it("skips a locked file, which is a refusal waiting to happen", () => {
    const responses: SlskdResponse[] = [
      {
        username: "ann",
        files: [
          file("@ann\\Nirvana\\Nevermind\\05 Lithium.flac", { isLocked: true }),
        ],
      },
    ];
    expect(rankCandidates(responses, want)).toEqual([]);
  });

  it("sorts by quality first", () => {
    const responses: SlskdResponse[] = [
      {
        username: "low",
        files: [
          file("@low\\Nirvana\\Nevermind\\Lithium.mp3", { bitRate: 128 }),
        ],
      },
      {
        username: "top",
        files: [file("@top\\Nirvana\\Nevermind\\Lithium.flac")],
      },
      {
        username: "mid",
        files: [
          file("@mid\\Nirvana\\Nevermind\\Lithium.mp3", { bitRate: 320 }),
        ],
      },
    ];
    expect(rankCandidates(responses, want).map((c) => c.username)).toEqual([
      "top",
      "mid",
      "low",
    ]);
  });

  it("breaks a tie on who will actually send it", () => {
    // Same tier is the same audio, and a peer three hundred deep never starts within 60 s.
    const f = "Nirvana\\Nevermind\\Lithium.flac";
    const responses: SlskdResponse[] = [
      { username: "busy", queueLength: 300, files: [file(`@busy\\${f}`)] },
      {
        username: "free",
        hasFreeUploadSlot: true,
        queueLength: 0,
        files: [file(`@free\\${f}`)],
      },
    ];
    expect(rankCandidates(responses, want).map((c) => c.username)).toEqual([
      "free",
      "busy",
    ]);
  });

  it("gives one entry per peer, keeping that peer's best file", () => {
    // A peer sharing a discography must not fill all ten places the switching operates on.
    const responses: SlskdResponse[] = [
      {
        username: "ann",
        files: [
          file("@ann\\Nirvana\\Nevermind\\Lithium.mp3", { bitRate: 128 }),
          file("@ann\\Nirvana\\Nevermind\\Lithium.flac"),
          file("@ann\\Nirvana\\Live\\Lithium.mp3", { bitRate: 320 }),
        ],
      },
    ];
    const out = rankCandidates(responses, want);
    expect(out).toHaveLength(1);
    expect(out[0].file.filename).toContain(".flac");
  });

  it("is stable, so the same search twice fails the same way", () => {
    const f = "Nirvana\\Nevermind\\Lithium.flac";
    const responses: SlskdResponse[] = [
      { username: "zoe", files: [file(`@zoe\\${f}`)] },
      { username: "amy", files: [file(`@amy\\${f}`)] },
    ];
    expect(rankCandidates(responses, want).map((c) => c.username)).toEqual([
      "amy",
      "zoe",
    ]);
  });
});

describe("classify", () => {
  it("reads the comma-joined flags slskd actually sends", () => {
    expect(classify("Completed, Succeeded")).toBe("done");
    expect(classify("Completed, Errored")).toBe("failed");
    expect(classify("Completed, Cancelled")).toBe("failed");
    expect(classify("Completed, TimedOut")).toBe("failed");
    expect(classify("Queued, Remotely")).toBe("queued");
    expect(classify("Requested")).toBe("queued");
    expect(classify("InProgress")).toBe("running");
  });

  it("counts Initializing as started — that is what the 60 s rule waits for", () => {
    expect(classify("Initializing")).toBe("running");
  });

  it("treats an unknown or missing state as still queued", () => {
    // The honest default: it has not started, so the timer keeps running and we move on.
    expect(classify(undefined)).toBe("queued");
    expect(classify("SomethingNew")).toBe("queued");
  });
});
