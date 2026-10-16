// shutdown.test.ts — a signal stops the listener and exits 0, once, and is installed for SIGTERM and SIGINT; stdin's end too, when asked.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exitOnSignals, exitOnStdinEnd, STDIN_STOP_ENV } from "./shutdown.ts";

const installed: ((s: string) => void)[] = [];
afterEach(() => {
  for (const f of installed.splice(0)) {
    process.off("SIGTERM", f);
    process.off("SIGINT", f);
  }
});

describe("exitOnSignals", () => {
  it("closes the server and exits 0 on SIGTERM, once", async () => {
    const server = createServer((_q, r) => r.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const exit = vi.fn();
    const stop = exitOnSignals(server, exit, 60_000);
    installed.push(stop);
    expect(process.listeners("SIGTERM")).toContain(stop);
    expect(process.listeners("SIGINT")).toContain(stop);
    stop("SIGTERM");
    stop("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it("exits after the grace when a request holds the server open", async () => {
    const server = createServer(() => {
      // never answers
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const pending = fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    await new Promise((r) => setTimeout(r, 50));
    const exit = vi.fn();
    const stop = exitOnSignals(server, exit, 100);
    installed.push(stop);
    stop("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    server.closeAllConnections();
    await pending;
  });
});

describe("exitOnStdinEnd", () => {
  it("stops on the end of stdin when asked, and drops the variable", () => {
    const env: NodeJS.ProcessEnv = { [STDIN_STOP_ENV]: "1" };
    const stdin = new PassThrough();
    const stop = vi.fn();
    expect(exitOnStdinEnd(stop, env, stdin)).toBe(true);
    expect(env[STDIN_STOP_ENV]).toBeUndefined();
    stdin.end();
    return vi.waitFor(() => expect(stop).toHaveBeenCalledWith("stdin closed"));
  });

  it("ignores stdin when the spawner did not ask", () => {
    const stdin = new PassThrough();
    const stop = vi.fn();
    expect(exitOnStdinEnd(stop, {}, stdin)).toBe(false);
    stdin.end();
    expect(stop).not.toHaveBeenCalled();
  });
});
