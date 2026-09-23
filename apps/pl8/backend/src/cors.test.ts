import { describe, expect, it, vi } from "vitest";
import { openCors } from "./cors.ts";

/** Just enough of Request/Response for the middleware to touch. */
function exchange(origin: string | undefined, method = "GET") {
  const headers: Record<string, string> = {};
  const req = { headers: { origin }, method } as never;
  let status: number | undefined;
  let ended = false;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (s: number) => {
      status = s;
      return res;
    },
    end: () => {
      ended = true;
    },
  } as never;
  const next = vi.fn();
  openCors(req, res, next);
  return { headers, status, ended, next };
}

describe("openCors", () => {
  it("reflects whichever origin asked, never a wildcard", () => {
    const { headers } = exchange("https://k7.priv.st0.app");
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://k7.priv.st0.app",
    );
    expect(headers.Vary).toBe("Origin");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("answers a preflight itself, without calling next", () => {
    const { status, ended, next } = exchange("https://k7.st0.app", "OPTIONS");
    expect(status).toBe(204);
    expect(ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets nothing and just continues when there is no Origin header", () => {
    const { headers, next } = exchange(undefined);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets an ordinary request through to the route", () => {
    const { next } = exchange("https://play.st0.app");
    expect(next).toHaveBeenCalledOnce();
  });
});
