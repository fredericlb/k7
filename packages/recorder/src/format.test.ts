// The date styles in both of the app's languages: the words follow the locale passed, never the machine's.

import { describe, expect, it } from "vitest";
import { fmtStamp, formatDate, sessionTitle } from "./format";

// Local time, so the clock reads 13:13 whatever the machine's zone.
const at = new Date(2026, 9, 27, 13, 13, 26);
// Intl puts a narrow no-break space before AM/PM in some ICU versions.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("formatDate", () => {
  it("words a day title in English and in French", () => {
    expect(formatDate(at, "day", "en")).toBe("Tuesday, October 27, 2026");
    expect(formatDate(at, "day", "fr")).toBe("mardi 27 octobre 2026");
  });

  it("words a date in a sentence", () => {
    expect(formatDate(at, "date", "en")).toBe("Oct 27, 2026");
    expect(formatDate(at, "date", "fr")).toBe("27 oct. 2026");
  });

  it("words a date and time", () => {
    expect(plain(formatDate(at, "dateTime", "en"))).toBe(
      "Oct 27, 2026, 1:13 PM",
    );
    expect(plain(formatDate(at, "dateTime", "fr"))).toBe("27 oct. 2026, 13:13");
  });

  it("words a clock with and without its seconds", () => {
    expect(plain(formatDate(at, "time", "en"))).toBe("1:13 PM");
    expect(formatDate(at, "time", "fr")).toBe("13:13");
    expect(plain(formatDate(at, "timeSeconds", "en"))).toBe("1:13:26 PM");
    expect(formatDate(at, "timeSeconds", "fr")).toBe("13:13:26");
  });

  it("takes an ISO string or a timestamp as well as a Date", () => {
    expect(formatDate(at.toISOString(), "date", "en")).toBe("Oct 27, 2026");
    expect(formatDate(at.getTime(), "date", "fr")).toBe("27 oct. 2026");
  });

  it("prints nothing for an unreadable date", () => {
    expect(formatDate("not a date", "day", "en")).toBe("");
  });
});

describe("session stamps", () => {
  it("name a session by its day and time in the app's language", () => {
    expect(plain(sessionTitle(at.toISOString(), "en"))).toBe("Oct 27, 1:13 PM");
    expect(sessionTitle(at.toISOString(), "fr")).toBe("27 oct., 13:13");
    expect(fmtStamp("fr", at)).toBe("27 oct., 13:13");
  });
});
