import type express from "express";
import { describe, expect, it, vi } from "vitest";
import { jsonErrors } from "./errors.ts";
import { TranscodeBusyError } from "./transcode.ts";

function fakeRes() {
  const res = {
    headersSent: false,
    headers: {} as Record<string, string>,
    code: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
    status(c: number) {
      res.code = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    destroy() {},
  };
  return res;
}

const answer = (err: Error) => {
  const res = fakeRes();
  jsonErrors(
    err,
    {} as express.Request,
    res as unknown as express.Response,
    () => {},
  );
  return res;
};

describe("jsonErrors", () => {
  it("answers a full re-encode queue as a 503 in words, with a Retry-After", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = answer(new TranscodeBusyError());
    expect(res.code).toBe(503);
    expect(res.headers["Retry-After"]).toBe("5");
    expect(res.body).toEqual({ error: new TranscodeBusyError().message });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("still hides a fault's message behind internal error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = answer(new Error("secret path /x"));
    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
    log.mockRestore();
  });
});
