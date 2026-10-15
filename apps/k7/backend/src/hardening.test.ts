import { describe, expect, it, vi } from "vitest";
import { errorBody, securityHeaders, shellFrameHeaders } from "./hardening.ts";

const fakeRes = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  };
};

describe("errorBody", () => {
  it("hides a 5xx message", () => {
    expect(errorBody(new Error("ENOENT /secret/path"))).toEqual({
      status: 500,
      error: "internal error",
    });
    expect(
      errorBody(Object.assign(new Error("db down"), { status: 503 })),
    ).toEqual({ status: 503, error: "internal error" });
  });

  it("passes a 4xx message through", () => {
    expect(
      errorBody(Object.assign(new Error("too large"), { status: 413 })),
    ).toEqual({ status: 413, error: "too large" });
    expect(
      errorBody(Object.assign(new Error("bad json"), { statusCode: 400 })),
    ).toEqual({ status: 400, error: "bad json" });
  });

  it("hides a 4xx message marked unexposed", () => {
    const missing = Object.assign(new Error("ENOENT, stat '/app/x'"), {
      status: 404,
      expose: false,
    });
    expect(errorBody(missing)).toEqual({ status: 404, error: "not found" });
  });

  it("treats a status that is no error as 500", () => {
    expect(errorBody(Object.assign(new Error("x"), { status: 200 }))).toEqual({
      status: 500,
      error: "internal error",
    });
  });
});

describe("headers", () => {
  it("sets nosniff and the referrer policy on every response", () => {
    const res = fakeRes();
    const next = vi.fn();
    securityHeaders({} as never, res as never, next);
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets the shell be framed by its own origin only", () => {
    const res = fakeRes();
    shellFrameHeaders(res as never);
    expect(res.headers["Content-Security-Policy"]).toBe(
      "frame-ancestors 'self'",
    );
    expect(res.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});
