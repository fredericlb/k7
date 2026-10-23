import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { allowedPath, DEVICE_HEADER, DOOR_PATH, deviceDoor } from "./door.ts";

const door = deviceDoor({
  deviceUser: (t) =>
    t === "good" ? { email: "fred@example.com", person: "sub-1" } : null,
  startSession: (req, user) => {
    (req as unknown as { session: unknown }).session = { user };
  },
});

function run(url: string, token?: string) {
  const req = {
    url,
    originalUrl: url,
    get: (h: string) => (h === DEVICE_HEADER ? token : undefined),
  } as unknown as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  const next = vi.fn();
  door(req, res as unknown as Response, next);
  return { req, res, next };
}

describe("allowedPath", () => {
  it("takes the listed prefixes and what is below them", () => {
    expect(allowedPath("/api/mediatek/song?x=1")).toBe(true);
    expect(allowedPath("/api/files-hub")).toBe(true);
    expect(allowedPath("/api/files/account/libraries")).toBe(true);
  });

  it("refuses what mints, pairs or spends", () => {
    expect(allowedPath("/api/sync/devices")).toBe(false);
    expect(allowedPath("/api/token")).toBe(false);
    expect(allowedPath("/api/hunt")).toBe(false);
    expect(allowedPath("/api/mediatek-other")).toBe(false);
  });

  it("refuses a dot segment, plain or encoded", () => {
    expect(allowedPath("/api/files/../sync/devices")).toBe(false);
    expect(allowedPath("/api/files/%2e%2E/sync/devices")).toBe(false);
  });
});

describe("deviceDoor", () => {
  it("lets every other path by untouched", () => {
    const { next, req } = run("/api/mediatek/song");
    expect(next).toHaveBeenCalled();
    expect(req.url).toBe("/api/mediatek/song");
  });

  it("answers 401 without a token it knows", () => {
    const { res, next } = run(`${DOOR_PATH}/api/mediatek/song`, "bad");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 403 for a path off the list", () => {
    const { res, next } = run(`${DOOR_PATH}/api/sync/devices`, "good");
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("signs the request in as the token's person and strips the prefix", () => {
    const { req, next } = run(`${DOOR_PATH}/api/songs?a=1`, "good");
    expect(next).toHaveBeenCalled();
    expect(req.url).toBe("/api/songs?a=1");
    expect((req as unknown as { session: unknown }).session).toEqual({
      user: {
        sub: "sub-1",
        email: "fred@example.com",
        name: "fred@example.com",
      },
    });
  });
});
