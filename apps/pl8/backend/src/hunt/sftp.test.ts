import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseName,
  fetchDownload,
  localPathFor,
  type SftpLike,
} from "./sftp.ts";
import { flattenTransfers } from "./slskd.ts";

describe("localPathFor", () => {
  it("rebuilds the layout slskd documents: the containing folder and the name", () => {
    expect(
      localPathFor(
        "@bob\\Music\\Nirvana\\Nevermind\\05 Lithium.flac",
        "/downloads",
      ),
    ).toBe("/downloads/Nevermind/05 Lithium.flac");
  });

  it("takes forward slashes too, since not every peer runs Windows", () => {
    expect(localPathFor("@ann/music/Kind of Blue/So What.flac", "/dl/")).toBe(
      "/dl/Kind of Blue/So What.flac",
    );
  });

  it("cannot be walked out of the downloads directory", () => {
    // This string comes off the Soulseek network, where a file name is whatever a stranger
    // typed — slskd's own docs warn that these values are hostile.
    for (const nasty of [
      "@u\\..\\..\\etc\\passwd",
      "../../../../etc/shadow",
      "@u\\.\\.\\.ssh\\id_rsa",
    ]) {
      const out = localPathFor(nasty, "/downloads");
      expect(out.startsWith("/downloads/")).toBe(true);
      expect(out).not.toContain("..");
    }
  });

  it("still yields a path for a bare file name", () => {
    expect(localPathFor("song.mp3", "/downloads")).toBe("/downloads/song.mp3");
  });
});

describe("baseName", () => {
  it("is the file's own name, whichever separator was used", () => {
    expect(baseName("@bob\\Music\\Nevermind\\05 Lithium.flac")).toBe(
      "05 Lithium.flac",
    );
    expect(baseName("a/b/c.mp3")).toBe("c.mp3");
  });
});

describe("flattenTransfers", () => {
  it("digs the transfers out of the nesting slskd wraps them in", () => {
    const body = {
      username: "bob",
      directories: [
        {
          directory: "Nevermind",
          files: [
            {
              id: "abc",
              filename: "@bob\\Nevermind\\Lithium.flac",
              state: "InProgress",
              size: 40,
              bytesTransferred: 10,
            },
          ],
        },
      ],
    };
    expect(flattenTransfers(body)).toEqual([
      {
        id: "abc",
        filename: "@bob\\Nevermind\\Lithium.flac",
        state: "InProgress",
        size: 40,
        bytesTransferred: 10,
        percentComplete: undefined,
      },
    ]);
  });

  it("takes a bare list as readily as a nested one", () => {
    // The nesting is slskd's to change, and a client that hard-coded one path through it
    // would report "no transfers" — which reads exactly like one that never started, and
    // would burn all ten switches for nothing.
    expect(
      flattenTransfers([{ id: "x", filename: "a.mp3", state: "Queued" }]),
    ).toHaveLength(1);
  });

  it("is empty rather than throwing on something unexpected", () => {
    expect(flattenTransfers(null)).toEqual([]);
    expect(flattenTransfers({ nothing: "here" })).toEqual([]);
    expect(flattenTransfers("a string")).toEqual([]);
  });
});

describe("fetchDownload — ce qui part dans les journaux", () => {
  let lines: string[] = [];

  /** A fake SFTP server: `at` is where the file REALLY is, `tree` what each directory holds (a
   *  name ending in `/` is a folder). */
  const fake = (at: string, tree: Record<string, string[]>): SftpLike => ({
    connect: async () => undefined,
    exists: async (p: string) => (p === at ? ("-" as const) : false),
    list: async (d: string) => {
      const rows = tree[d];
      if (!rows) throw new Error("No such file");
      return rows.map((n) => ({
        name: n.replace(/\/$/, ""),
        type: n.endsWith("/") ? "d" : "-",
        size: 1,
      }));
    },
    get: async () => Buffer.alloc(3),
    end: async () => undefined,
  });

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    process.env.SLSKD_SFTP_HOST = "slskd.test";
    process.env.SLSKD_SFTP_USER = "bob";
    process.env.SLSKD_SFTP_KEY = "SECRET-KEY-MATERIAL";
    process.env.SLSKD_DOWNLOADS_DIR = "/downloads";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("écrit le chemin visé ET le contenu du dossier de téléchargement", async () => {
    // The two questions asked when nothing arrives, answered while the answer is to hand — that
    // is, during the connection, not after.
    const remote = "@ann\\Music\\Nirvana\\Nevermind\\05 Lithium.flac";
    await fetchDownload(remote, () =>
      fake("/downloads/Nevermind/05 Lithium.flac", {
        "/downloads": ["Nevermind/", "readme.txt"],
      }),
    );
    const all = lines.join("\n");
    expect(all).toContain(remote);
    expect(all).toContain(
      "chemin visé      : /downloads/Nevermind/05 Lithium.flac",
    );
    expect(all).toContain("/downloads : 2 entrée(s)");
    expect(all).toContain("[d] Nevermind");
    expect(all).toContain("[-] readme.txt");
  });

  it("dit où il a fini par le trouver quand ce n'est pas là", async () => {
    // The case that made a failure indistinguishable from a song nobody shares.
    await fetchDownload("@ann\\x\\y\\Lithium.flac", () =>
      fake("/downloads/complete/Lithium.flac", {
        "/downloads": ["complete/"],
        "/downloads/complete": ["Lithium.flac"],
      }),
    );
    const all = lines.join("\n");
    expect(all).toContain("pas à l'endroit attendu");
    expect(all).toContain(
      "trouvé ailleurs  : /downloads/complete/Lithium.flac",
    );
  });

  it("n'écrit jamais la clé ni le mot de passe", async () => {
    await fetchDownload("@a\\b\\c.flac", () =>
      fake("/downloads/b/c.flac", { "/downloads": ["b/"] }),
    );
    const all = lines.join("\n");
    expect(all).not.toContain("SECRET-KEY-MATERIAL");
    // The FACT that there is a key helps diagnosis; its value does not.
    expect(all).toContain("(clé)");
  });
});
