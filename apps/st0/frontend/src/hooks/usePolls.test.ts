// The rule that decides when a TAKE has landed. Its own function because the failure it
// prevents is invisible in a hook: `lastTake` is the file service's MEMORY of the newest take
// it ever wrote, so a rule that fires on "there is a take" reopens this morning's recording
// every time a tab loads — and a rule that never fires leaves a take on disk and off the screen,
// which is the bug this was written for.

import { describe, expect, it } from "vitest";
import { isNewTake } from "./usePolls";

describe("a take this tab has not seen", () => {
  it("says nothing about the FIRST answer, whatever it holds", () => {
    // Seeding. The tab has just loaded; whatever the service remembers is not news.
    expect(isNewTake(undefined, "gtr_1.1_260816T000616")).toBe(false);
    expect(isNewTake(undefined, null)).toBe(false);
  });

  it("fires when the name changes to another take", () => {
    expect(isNewTake("gtr_1.1_old", "gtr_1.1_new")).toBe(true);
  });

  it("fires on the first take of a session that had none", () => {
    // `null` is a read answer — "there is no take" — not an unread one.
    expect(isNewTake(null, "gtr_1.1_new")).toBe(true);
  });

  it("stays quiet while the same take is reported over and over", () => {
    // It is reported every 2 s for ever after; firing each time would reopen the panel on a
    // take the person has already closed.
    expect(isNewTake("gtr_1.1_new", "gtr_1.1_new")).toBe(false);
  });

  it("stays quiet when the service forgets one — that is not a recording", () => {
    // The memory dies with the process, so a restart answers null. Nothing was recorded.
    expect(isNewTake("gtr_1.1_new", null)).toBe(false);
  });
});
