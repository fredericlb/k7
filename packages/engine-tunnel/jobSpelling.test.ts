// jobSpelling.test.ts — a Windows server's job paths reach the machine in the tunnel's spelling, a POSIX server's untouched.

import { describe, expect, it } from "vitest";
import type { TunnelRoot } from "./frames.ts";
import { tunnelPath, tunnelSpelling } from "./jobSpelling.ts";

const WS = "C:\\k7\\workspaces\\me\\workspace";
const RENDERS = "C:\\k7\\workspaces\\me\\.renders";
const roots: TunnelRoot[] = [
  { remote: WS, name: "ws-me", writable: true },
  { remote: RENDERS, name: "renders-me", writable: true },
];

describe("tunnelPath", () => {
  it("joins below a root with `/`, the root kept as the server names it", () => {
    expect(tunnelPath(`${RENDERS}\\ab\\cd.wav`, roots, "\\")).toBe(
      `${RENDERS}/ab/cd.wav`,
    );
  });

  it("leaves a path outside every root, the root itself and an already-spelt path alone", () => {
    expect(tunnelPath("C:\\elsewhere\\x.wav", roots, "\\")).toBe(
      "C:\\elsewhere\\x.wav",
    );
    expect(tunnelPath(WS, roots, "\\")).toBe(WS);
    expect(tunnelPath(`${WS}/a/b.wav`, roots, "\\")).toBe(`${WS}/a/b.wav`);
  });

  it("changes nothing on a `/` server", () => {
    const posix: TunnelRoot[] = [
      { remote: "/srv/ws", name: "ws", writable: true },
    ];
    expect(tunnelPath("/srv/ws/a/b.wav", posix, "/")).toBe("/srv/ws/a/b.wav");
  });
});

describe("tunnelSpelling", () => {
  it("rewrites every path of a render job, nested ones included", () => {
    const job = {
      type: "render",
      out: `${RENDERS}\\f.wav`,
      doc: {
        tracks: [{ clips: [{ source: `${WS}\\song\\clips\\a.wav` }] }],
        bpm: 110,
      },
    };
    expect(
      JSON.parse(tunnelSpelling(JSON.stringify(job), roots, "\\")),
    ).toEqual({
      type: "render",
      out: `${RENDERS}/f.wav`,
      doc: {
        tracks: [{ clips: [{ source: `${WS}/song/clips/a.wav` }] }],
        bpm: 110,
      },
    });
  });

  it("names a path by the nearer of two nested roots", () => {
    const nested: TunnelRoot[] = [
      { remote: "C:\\a", name: "outer", writable: false },
      { remote: "C:\\a\\b", name: "inner", writable: true },
    ];
    expect(
      tunnelSpelling(JSON.stringify("C:\\a\\b\\c.wav"), nested, "\\"),
    ).toBe(JSON.stringify("C:\\a\\b/c.wav"));
  });

  it("passes a frame that is not JSON untouched", () => {
    expect(tunnelSpelling("not json", roots, "\\")).toBe("not json");
  });
});
