// splash.test.ts — the splash pages are self-contained data URLs, and a failure's text cannot inject markup.

import { describe, expect, it } from "vitest";
import { destination } from "./routing.ts";
import { failedPage, startingPage } from "./splash.ts";

const html = (url: string) =>
  decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));

describe("splash", () => {
  it("is a data URL with no link and nothing fetched", () => {
    const url = startingPage();
    expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(html(url)).not.toMatch(/href=|src=|https?:/);
  });

  it("escapes the failure and names the log", () => {
    const page = html(failedPage(`port <b>18789</b> & "x"`, "/tmp/k7 log"));
    expect(page).toContain("port &lt;b&gt;18789&lt;/b&gt; &amp; &quot;x&quot;");
    expect(page).toContain("Log: /tmp/k7 log");
    expect(page).not.toContain("<b>");
  });

  it("never counts as one of k7's pages", () => {
    expect(destination(startingPage(), "http://127.0.0.1:18789")).toEqual({
      to: "browser",
    });
  });
});
