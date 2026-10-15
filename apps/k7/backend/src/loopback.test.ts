import { describe, expect, it, vi } from "vitest";
import {
  isLoopbackAddress,
  isLoopbackHost,
  isLoopbackRequest,
  loopbackOnly,
} from "./loopback.ts";

const req = (remoteAddress: string, host: string | undefined) =>
  ({ socket: { remoteAddress }, headers: { host } }) as never;

describe("isLoopbackHost", () => {
  it("accepts this machine's names, port or not", () => {
    for (const h of [
      "127.0.0.1:18789",
      "localhost",
      "localhost:1",
      "[::1]:18789",
    ])
      expect(isLoopbackHost(h)).toBe(true);
  });

  it("refuses a LAN address, a rebound name and nothing at all", () => {
    for (const h of [
      "192.168.1.4:18789",
      "evil.example",
      "127.0.0.1.evil.example",
      "",
    ])
      expect(isLoopbackHost(h)).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});

describe("isLoopbackAddress", () => {
  it("accepts IPv4, IPv6 and the IPv4-mapped spelling", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
      expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ["192.168.1.4", "::ffff:10.0.0.2", undefined])
      expect(isLoopbackAddress(a)).toBe(false);
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
