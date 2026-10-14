// namespaceMigrate.test.ts — the old library spellings rewritten in a file's text: the levels, the modules
// k7-core renamed, the pin; and a name that only starts like one left alone.

import { describe, expect, it } from "vitest";
import { migrateNamespaceText } from "./namespaceMigrate";

describe("migrateNamespaceText", () => {
  it("moves @st0 and @mediatek to @k7-core", () => {
    const { after, hits } = migrateNamespaceText(
      "chains/a.k7x",
      'extends("@st0/audio/amp")\nextends("@mediatek/audio/eq")\n',
    );
    expect(after).toBe(
      'extends("@k7-core/audio/amp")\nextends("@k7-core/audio/eq")\n',
    );
    expect(hits).toBe(2);
  });

  it("renames the modules k7-core renamed, and not one that only starts the same", () => {
    const { after } = migrateNamespaceText(
      "chains/d.yaml",
      'a: "@st0/instruments/st0-rack"\nb: "@k7-core/instruments/st0-4osc"\nc: "@st0/instruments/st0-rack-sfz"\n',
    );
    expect(after).toBe(
      'a: "@k7-core/instruments/k7-rack"\nb: "@k7-core/instruments/k7-4osc"\nc: "@k7-core/instruments/st0-rack-sfz"\n',
    );
  });

  it("re-keys the library pin", () => {
    const { after } = migrateNamespaceText("_library-pins.yaml", "st0: 1\n");
    expect(after).toBe("k7-core: 1\n");
  });

  it("changes nothing in a file done already", () => {
    const text = 'extends("@k7-core/instruments/k7-rack")\n';
    expect(migrateNamespaceText("x.k7x", text)).toEqual({
      after: text,
      hits: 0,
    });
  });
});
