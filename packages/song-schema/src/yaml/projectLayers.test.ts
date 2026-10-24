// `layers` in project.k7x: an empty list, which most songs carry, is read by nothing; naming a lane
// means picture lanes their open did not migrate, refused with what replaced it (docs/formatLevel.md).
import { describe, expect, it } from "vitest";
import { ProjectFileSchema } from "./projectSchema";

const root = (layers: unknown) => ({
  project: { name: "s", tempo: 120, layers },
});

describe("project.layers", () => {
  it("is accepted empty, and read by nothing", () => {
    expect(ProjectFileSchema.safeParse(root([])).success).toBe(true);
  });

  it("is refused naming a lane, saying what draws the picture now", () => {
    const r = ProjectFileSchema.safeParse(root(["main"]));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/trackOrder/);
  });
});
