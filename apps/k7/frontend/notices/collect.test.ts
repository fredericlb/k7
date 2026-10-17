// collect.test.ts — the notices generator on a made-up tree, then on this repository: nothing shipped
// goes unaccounted, and the hand list keeps up with the builds that pin what it describes.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type ComponentsFile,
  collect,
  licenseOf,
  standardIds,
} from "./collect.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");

/** A package.json, and the files beside it. */
function pkg(
  dir: string,
  manifest: object,
  files: Record<string, string> = {},
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, name), text);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "notices-"));
  writeFileSync(join(root, "LICENSE"), "GPL-3.0 text");
  const notices = join(root, "notices");
  mkdirSync(join(notices, "licenses"), { recursive: true });
  mkdirSync(join(notices, "texts"), { recursive: true });
  writeFileSync(join(notices, "licenses", "Apache-2.0.txt"), "Apache text");
  writeFileSync(
    join(notices, "components.json"),
    JSON.stringify({
      npmOverrides: { checked: { license: "ISC", reason: "read by hand" } },
      components: [],
    }),
  );
  const nm = join(root, "node_modules");
  pkg(join(root, "app"), {
    name: "app",
    version: "1.0.0",
    dependencies: { shared: "*", nameless: "*", old: "*" },
  });
  pkg(join(root, "server"), {
    name: "server",
    version: "1.0.0",
    dependencies: { shared: "*", apache: "*", gpl2: "*", checked: "*" },
    devDependencies: { tool: "*" },
  });
  pkg(
    join(nm, "shared"),
    {
      name: "shared",
      version: "2.0.0",
      license: "MIT",
      dependencies: { old: "*" },
    },
    { LICENSE: "MIT, Shared Corp" },
  );
  // Two copies of `old`: the hoisted one and the one `shared` nests.
  pkg(
    join(nm, "old"),
    { name: "old", version: "1.0.0", license: "MIT" },
    { "LICENSE.md": "MIT, Old Corp" },
  );
  pkg(
    join(nm, "shared", "node_modules", "old"),
    { name: "old", version: "0.9.0", license: "MIT" },
    { LICENSE: "MIT, Old Corp" },
  );
  pkg(join(nm, "nameless"), { name: "nameless", version: "1.0.0" });
  pkg(join(nm, "apache"), {
    name: "apache",
    version: "1.0.0",
    license: "Apache-2.0",
  });
  pkg(
    join(nm, "gpl2"),
    { name: "gpl2", version: "1.0.0", license: "GPL-2.0-only" },
    { COPYING: "GPL-2.0" },
  );
  pkg(
    join(nm, "checked"),
    { name: "checked", version: "1.0.0" },
    { LICENSE: "ISC, Checked" },
  );
  pkg(join(nm, "tool"), { name: "tool", version: "1.0.0", license: "MIT" });
  return collect(root, {
    here: notices,
    roots: [
      { dir: "app", where: "web" },
      { dir: "server", where: "server" },
    ],
  });
}

describe("the generator, on a made-up tree", () => {
  const { notices, errors, warnings } = fixture();
  const byId = new Map(
    notices.entries.map((e) => [`${e.name}@${e.version}`, e]),
  );

  it("lists a package reached from two apps once, shipped in both", () => {
    expect(byId.get("shared@2.0.0")?.where).toEqual(["server", "web"]);
    expect(notices.entries.filter((e) => e.name === "shared")).toHaveLength(1);
  });

  it("keeps two versions of one package apart", () => {
    expect(byId.has("old@1.0.0")).toBe(true);
    expect(byId.has("old@0.9.0")).toBe(true);
  });

  it("stores a text two packages share once", () => {
    const keys = ["old@1.0.0", "old@0.9.0"].map((id) => byId.get(id)?.text);
    expect(keys[0]).toBe(keys[1]);
    expect(notices.texts[keys[0] ?? ""]).toBe("MIT, Old Corp");
  });

  it("never lists a dev dependency or the apps themselves", () => {
    expect(byId.has("tool@1.0.0")).toBe(false);
    expect(byId.has("app@1.0.0")).toBe(false);
  });

  it("refuses a production dependency whose licence nobody names", () => {
    expect(errors).toEqual([expect.stringContaining("nameless@1.0.0")]);
    expect(byId.has("nameless@1.0.0")).toBe(false);
  });

  it("takes a hand-checked override for a manifest that names none", () => {
    expect(byId.get("checked@1.0.0")?.license).toBe("ISC");
  });

  it("points a package with no file at the stored standard text", () => {
    expect(byId.get("apache@1.0.0")).toMatchObject({
      text: null,
      standards: ["Apache-2.0"],
    });
    expect(notices.standards["Apache-2.0"]).toBe("Apache text");
    expect(warnings.some((w) => w.includes("apache@"))).toBe(false);
  });

  it("flags a licence GPLv3 cannot take", () => {
    expect(warnings).toContainEqual(
      expect.stringContaining("gpl2@1.0.0 is GPL-2.0-only"),
    );
  });

  it("carries k7's own GPLv3 from the root LICENSE", () => {
    expect(notices.standards["GPL-3.0"]).toBe("GPL-3.0 text");
  });
});

describe("licence expressions", () => {
  it("reads the old manifest shapes", () => {
    expect(
      licenseOf({ name: "a", version: "1", license: { type: "MIT" } }),
    ).toBe("MIT");
    expect(
      licenseOf({
        name: "a",
        version: "1",
        licenses: [{ type: "MIT" }, { type: "Apache-2.0" }],
      }),
    ).toBe("(MIT OR Apache-2.0)");
    expect(licenseOf({ name: "a", version: "1", license: "MPL 2.0" })).toBe(
      "MPL-2.0",
    );
  });

  it("folds -only and -or-later onto one stored text", () => {
    const known = new Set(["GPL-3.0", "Apache-2.0"]);
    expect(standardIds("GPL-3.0-or-later AND MIT", known)).toEqual(["GPL-3.0"]);
    expect(standardIds("Apache-2.0 WITH LLVM-exception", known)).toEqual([
      "Apache-2.0",
    ]);
  });
});

describe("this repository's notices", () => {
  const { notices, errors } = collect(repo);
  const file = JSON.parse(
    readFileSync(join(here, "components.json"), "utf8"),
  ) as ComponentsFile;
  const read = (p: string) => readFileSync(join(repo, p), "utf8");

  it("names a licence for every production dependency of every shipped app", () => {
    expect(errors).toEqual([]);
    for (const e of notices.entries) expect(e.license, e.name).toBeTruthy();
  });

  it("accounts for every library the engine and its supervisor fetch", () => {
    const fetched = [
      "engine/k7-runtime/CMakeLists.txt",
      "engine/k7-supervisor/CMakeLists.txt",
    ].flatMap((f) =>
      [...read(f).matchAll(/FetchContent_Declare\((\w+)/g)].map(
        (m) => m[1] ?? "",
      ),
    );
    const listed = new Set(
      file.components.flatMap((c) => c.fetchContent ?? []),
    );
    expect(fetched.filter((n) => !listed.has(n))).toEqual([]);
  });

  it("accounts for every Termux package the phone carries", () => {
    const pins = Object.keys(
      JSON.parse(read("engine/k7-android/scripts/termux-packages.json")),
    );
    const listed = new Set(file.components.flatMap((c) => c.termux ?? []));
    expect(pins.filter((p) => !listed.has(p))).toEqual([]);
  });

  it("accounts for every OS package the two runtime images install", () => {
    const runtime = (f: string) => read(f).split(/ AS runtime/)[1] ?? "";
    const apk = [
      ...runtime("apps/k7/docker/Dockerfile").matchAll(
        /apk add --no-cache ([^\n\\]+)/g,
      ),
    ].flatMap((m) => (m[1] ?? "").trim().split(/\s+/));
    const apt = (
      runtime("engine/docker/Dockerfile").match(
        /--no-install-recommends([\s\S]*?)&&/,
      )?.[1] ?? ""
    )
      .replace(/\\/g, " ")
      .trim()
      .split(/\s+/);
    expect(apk.length).toBeGreaterThan(0);
    expect(apt.length).toBeGreaterThan(0);
    const listed = new Set(
      file.components.flatMap((c) => [...(c.apk ?? []), ...(c.apt ?? [])]),
    );
    expect([...apk, ...apt].filter((p) => !listed.has(p))).toEqual([]);
  });

  it("keeps each hand-written version where the build pins it", () => {
    for (const c of file.components)
      if (c.source && c.version)
        expect(read(c.source), c.name).toContain(c.version.replace(/^v/, ""));
  });

  it("uses every text and standard licence it stores", () => {
    const texts = new Set(file.components.map((c) => c.text).filter(Boolean));
    expect(
      readdirSync(join(here, "texts")).filter((f) => !texts.has(f)),
    ).toEqual([]);
    const stored = readdirSync(join(here, "licenses")).map((f) =>
      f.replace(/\.txt$/, ""),
    );
    expect(stored.filter((id) => !(id in notices.standards))).toEqual([]);
  });
});
