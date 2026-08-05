// remote.test.ts — the hosted library seen from a cache, against a real server. What it
// guards is the FAILURE: a download that breaks halfway must say why, and must not leave its
// bytes where a whole file is expected.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteError, remoteLibrary } from "./remote.ts";

let server: Server;
let base: string;
let dir: string;
/** What the stand-in library does with the next `/file` request. */
let mode: "whole" | "cut" = "whole";

const BODY = "x".repeat(2048);

/** The error a promise rejected with. A named helper because `.catch(e => e)` widens to
 *  `void | Error`, and the assertions below are all about the message. */
const caught = (p: Promise<unknown>): Promise<Error> =>
  p.then(
    () => new Error("it did not throw"),
    (e: Error) => e,
  );

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mediatek-remote-"));
  mode = "whole";
  server = createServer((_req, res) => {
    if (mode === "whole") {
      res.writeHead(200, { "content-length": String(BODY.length) });
      return void res.end(BODY);
    }
    // A body that stops: the length promises 2048 bytes and the socket dies after 16. This is
    // exactly what `fetch` reports as `TypeError: terminated`, with the reason in `cause`.
    res.writeHead(200, { "content-length": String(BODY.length) });
    res.write(BODY.slice(0, 16));
    setTimeout(() => res.socket?.destroy(), 10);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe("remoteLibrary.download", () => {
  it("writes the file, leaving no temporary behind", async () => {
    const dest = join(dir, "songs", "a", "original.wav");
    await remoteLibrary({ base }).download("songs/a/original.wav", dest);
    expect(readFileSync(dest, "utf8")).toBe(BODY);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("leaves nothing at all when the body stops halfway", async () => {
    mode = "cut";
    const dest = join(dir, "songs", "a", "original.wav");
    await expect(
      remoteLibrary({ base }).download("songs/a/original.wav", dest),
    ).rejects.toThrow(RemoteError);
    // The point of the temporary name: `dest` is this machine's cache, and half a master
    // there plays until it stops rather than announcing that it is short.
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("says WHY, not just that the body ended", async () => {
    mode = "cut";
    const dest = join(dir, "songs", "a", "original.wav");
    const e = await caught(
      remoteLibrary({ base }).download("songs/a/original.wav", dest),
    );
    // `terminated` alone was the whole of a real bug report — it names neither the library it
    // tried nor what went wrong. Both have to survive the trip back through HTTP to a browser.
    expect(e.message).toContain(base);
    expect(e.message).toContain("songs/a/original.wav");
    expect(e.message).toContain("←"); // the cause chain, not just "terminated"
  });

  it("names the address when the library cannot be reached at all", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const e = await caught(
      remoteLibrary({ base }).download(
        "songs/a/original.wav",
        join(dir, "x.wav"),
      ),
    );
    // The URL is DERIVED rather than typed (see mediatekUrlFor), so "which library did it
    // even try" is half the answer whenever the answer is "the wrong one".
    expect(e.message).toContain(base);
    expect(e).toBeInstanceOf(RemoteError);
  });
});
