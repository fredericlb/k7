import { describe, expect, it, vi } from "vitest";
import {
  isLoopbackHostHeader,
  isLoopbackRequest,
  loopbackOnly,
} from "./loopback.ts";

const req = (remoteAddress: string, host: string | undefined) =>
  ({ socket: { remoteAddress }, headers: { host } }) as never;

describe("isLoopbackHostHeader", () => {
  it("accepts this machine's names, port or not", () => {
    for (const h of [
      "127.0.0.1:18789",
      "localhost",
      "localhost:1",
      "[::1]:18789",
    ])
      expect(isLoopbackHostHeader(h)).toBe(true);
  });

  it("refuses a LAN address, a rebound name and nothing at all", () => {
    for (const h of [
      "192.168.1.4:18789",
      "evil.example",
      "127.0.0.1.evil.example",
      "",
    ])
      expect(isLoopbackHostHeader(h)).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });
});

describe("isLoopbackRequest", () => {
  it("needs both the peer and the Host", () => {
    expect(isLoopbackRequest(req("127.0.0.1", "127.0.0.1:18789"))).toBe(true);
    expect(isLoopbackRequest(req("192.168.1.4", "127.0.0.1:18789"))).toBe(
      false,
    );
    expect(
      isLoopbackRequest(req("127.0.0.1", "rebound.evil.example:18789")),
    ).toBe(false);
  });
});

describe("loopbackOnly", () => {
  it("answers 403 to anything else", () => {
    let status = 0;
    const res = {
      status: (s: number) => {
        status = s;
        return res;
      },
      send: () => {},
    } as never;
    const next = vi.fn();
    loopbackOnly(req("127.0.0.1", "evil.example"), res, next);
    expect(status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    loopbackOnly(req("127.0.0.1", "localhost:18789"), res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
