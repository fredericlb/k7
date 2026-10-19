import { describe, expect, it, vi } from "vitest";
import { SITE_PAGE, siteHostsFromEnv, sitePage } from "./sitePage.ts";

const hosts = siteHostsFromEnv("k7.rocks, www.k7.rocks");

function run(hostname: string, path: string, method = "GET") {
  const res = {
    redirect: vi.fn(),
    setHeader: vi.fn(),
    type: vi.fn(() => res),
    send: vi.fn(),
  };
  const next = vi.fn();
  sitePage(hosts)({ hostname, path, method } as never, res as never, next);
  return { res, next };
}

describe("siteHostsFromEnv", () => {
  it("reads a comma or space list, and nothing when unset", () => {
    expect([...siteHostsFromEnv("K7.rocks www.k7.rocks,")]).toEqual([
      "k7.rocks",
      "www.k7.rocks",
    ]);
    expect(siteHostsFromEnv(undefined).size).toBe(0);
  });
});

describe("sitePage", () => {
  it("answers the root of both hosts with the splash and the message", () => {
    for (const host of ["k7.rocks", "www.k7.rocks"]) {
      const { res, next } = run(host, "/");
      expect(next).not.toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledWith(SITE_PAGE);
    }
    expect(SITE_PAGE).toContain("Coming soon");
    expect(SITE_PAGE).toContain("<svg");
    expect(SITE_PAGE).toContain("#07031F");
  });

  it("lets the downloads and the icon through", () => {
    for (const path of [
      "/app_downloads",
      "/app_downloads/release.json",
      "/favicon.ico",
    ])
      expect(run("k7.rocks", path).next).toHaveBeenCalled();
  });

  it("sends every other address to the page", () => {
    for (const path of ["/media", "/api/health", "/app_downloadsx"])
      expect(run("www.k7.rocks", path).res.redirect).toHaveBeenCalledWith(
        302,
        "/",
      );
    expect(run("k7.rocks", "/", "POST").res.redirect).toHaveBeenCalled();
  });

  it("leaves the app's own hosts alone", () => {
    const { res, next } = run("app.k7.rocks", "/");
    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
