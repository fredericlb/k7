// What a demo link may be. The refusals matter more than the acceptances: an `href` takes
// whatever it is given, and a `javascript:` URL in one is how a page gets hijacked.

import { describe, expect, it } from "vitest";
import { isYouTubeUrl } from "./youtube";

describe("isYouTubeUrl", () => {
  it("takes the forms a link actually arrives in", () => {
    for (const ok of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "  https://youtube.com/watch?v=x  ",
    ])
      expect(isYouTubeUrl(ok)).toBe(true);
  });

  it("refuses another site, however much it looks like one", () => {
    expect(isYouTubeUrl("https://notyoutube.com/watch?v=x")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.evil.test/watch?v=x")).toBe(false);
  });

  it("refuses anything that is not an http(s) URL", () => {
    expect(isYouTubeUrl("javascript:alert(1)")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
  });
});
