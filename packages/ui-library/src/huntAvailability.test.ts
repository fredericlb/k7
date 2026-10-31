import { describe, expect, it } from "vitest";
import { availabilityOf, unavailableNotice } from "./huntAvailability";

const L = {
  notSetUp: "Automatic download is not set up.",
  gap: { slskd: "slskd", sftp: "SFTP" },
  missingList: (list: string) => `Missing: ${list}.`,
};

describe("the add-song popin's download notice", () => {
  it("says nothing when the download can run", () => {
    const a = availabilityOf({
      configured: true,
      reason: null,
      missing: [],
      youtube: false,
      hunts: [],
    });
    expect(unavailableNotice(a, L)).toBeNull();
  });

  it("words the blank settings itself, never the server's sentence", () => {
    const a = availabilityOf({
      configured: false,
      reason: "à renseigner dans les paramètres",
      missing: ["slskd", "sftp"],
      youtube: false,
      hunts: [],
    });
    expect(unavailableNotice(a, L)).toEqual({
      title: "Automatic download is not set up.",
      detail: "Missing: slskd, SFTP.",
    });
  });

  it("falls back on the server's reason when it names no gap", () => {
    const a = availabilityOf({
      configured: false,
      reason: "network down",
      missing: [],
      youtube: false,
      hunts: [],
    });
    expect(unavailableNotice(a, L)?.detail).toBe("network down");
  });
});
