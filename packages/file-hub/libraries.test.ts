// The hub's LibraryStore over REAL git: the list validated and written, each library cloned ONCE
// with the server's key, a push from elsewhere counted on a sync and taken only on a pull, dropped
// clones pruned, failures remembered, the accounts' former lists merged when the origin has none
// yet, and a pull's bench drop. See docs/fileHub.md.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropBenches } from "./benchDrop.ts";
import { LibraryStore, settingsProblem } from "./libraries.ts";

vi.setConfig({ testTimeout: 30_000 });

const URI = "git@example.test:studio/st0.git";
const OTHER = "git@example.test:studio/drums.git";
let tmp: string;
let origin: string;
let data: string;
const ENV_KEYS = [
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_KEY_1",
  "GIT_CONFIG_VALUE_1",
  "GIT_CONFIG_KEY_2",
  "GIT_CONFIG_VALUE_2",
  "GIT_CONFIG_KEY_3",
  "GIT_CONFIG_VALUE_3",
];
const saved: Record<string, string | undefined> = {};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.test",
    },
  }).trim();

/** A bare repository with one file, as a git host would hold it. */
function bareWith(name: string, file: string, body: string): string {
  const bare = join(tmp, `${name}.git`);
  git(tmp, "init", "-q", "--bare", "--initial-branch=main", bare);
  publish(bare, file, body);
  return bare;
}

/** Somebody's push, from a clone of their own. */
function publish(bare: string, file: string, body: string): void {
  const other = mkdtempSync(join(tmp, "push-"));
  git(other, "clone", "-q", bare, ".");
  writeFileSync(join(other, file), body);
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", `publish ${file}`);
  git(other, "push", "-q", "origin", "HEAD");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hub-libs-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  origin = bareWith("st0", "amp.yaml", "gain: 1\n");
  const drums = bareWith("drums", "kick.yaml", "x: 1\n");
  // Both SSH URIs rewritten to the bare repositories, as COMMAND-LEVEL config the service's env keeps.
  process.env.GIT_CONFIG_COUNT = "3";
  process.env.GIT_CONFIG_KEY_0 = `url.${origin}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = URI;
  process.env.GIT_CONFIG_KEY_1 = `url.${drums}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_1 = OTHER;
  process.env.GIT_CONFIG_KEY_2 = "protocol.file.allow";
  process.env.GIT_CONFIG_VALUE_2 = "always";
  data = join(tmp, "data");
  // A server key already "there", so none is generated: CI has no ssh-keygen, and no key is used.
  const keyDir = join(data, ".libraries-key");
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, "id_ed25519"), "placeholder\n");
  writeFileSync(join(keyDir, "id_ed25519.pub"), "ssh-ed25519 AAAA test\n");
});

afterEach(() => {
  for (const k of ENV_KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  rmSync(tmp, { recursive: true, force: true });
});

describe("the hub's libraries", () => {
  it("clones each library once, where every account reads it, and writes the list", async () => {
    const store = new LibraryStore(data);
    const r = await store.set([{ uri: URI }, { uri: OTHER }]);
    expect(
      "reply" in r && r.reply.libraries.map((l) => [l.name, l.cloned]),
    ).toEqual([
      ["st0", true],
      ["drums", true],
    ]);
    expect(
      readFileSync(join(data, "libraries", "st0", "amp.yaml"), "utf8"),
    ).toBe("gain: 1\n");
    expect(
      JSON.parse(readFileSync(join(data, "libraries.json"), "utf8")),
    ).toEqual({
      libraries: [
        { name: "st0", uri: URI },
        { name: "drums", uri: OTHER },
      ],
    });
  });

  it("sees a push without taking it: a forced sync fetches and counts what is to pull", async () => {
    const store = new LibraryStore(data);
    await store.set([{ uri: URI }]);
    publish(origin, "amp.yaml", "gain: 2\n");
    const notes = await store.sync({ name: "st0", force: true });
    expect(notes[0]).toMatchObject({ name: "st0", state: "behind" });
    expect(store.view().libraries[0]).toMatchObject({ name: "st0", behind: 1 });
    expect(
      readFileSync(join(data, "libraries", "st0", "amp.yaml"), "utf8"),
    ).toBe("gain: 1\n");
  });

  it("follows a push on a pull: the clone is made exactly its remote", async () => {
    const store = new LibraryStore(data);
    await store.set([{ uri: URI }]);
    publish(origin, "amp.yaml", "gain: 2\n");
    // A stray write in the clone is nobody's work, and goes.
    writeFileSync(join(data, "libraries", "st0", "stray.yaml"), "x\n");
    const notes = await store.sync({ name: "st0", pull: true });
    expect(notes[0]).toMatchObject({ name: "st0", state: "updated" });
    expect(store.view().libraries[0].behind).toBeUndefined();
    expect(
      readFileSync(join(data, "libraries", "st0", "amp.yaml"), "utf8"),
    ).toBe("gain: 2\n");
    expect(existsSync(join(data, "libraries", "st0", "stray.yaml"))).toBe(
      false,
    );
  });

  it("counts what to pull into a clone made while its repository was EMPTY", async () => {
    const empty = join(tmp, "empty.git");
    git(tmp, "init", "-q", "--bare", "--initial-branch=main", empty);
    process.env.GIT_CONFIG_COUNT = "4";
    process.env.GIT_CONFIG_KEY_3 = `url.${empty}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_3 = "git@example.test:studio/empty.git";
    const store = new LibraryStore(data);
    await store.set([{ uri: "git@example.test:studio/empty.git" }]);
    publish(empty, "a.yaml", "a: 1\n");
    publish(empty, "b.yaml", "b: 1\n");
    await store.sync({ force: true });
    expect(store.view().libraries[0]).toMatchObject({ behind: 2 });
    await store.sync({ pull: true });
    expect(store.view().libraries[0].behind).toBeUndefined();
    expect(existsSync(join(data, "libraries", "st0", "b.yaml"))).toBe(true);
  });

  it("prunes the clone of a library the list dropped", async () => {
    const store = new LibraryStore(data);
    await store.set([{ uri: URI }, { uri: OTHER }]);
    await store.set([{ name: "st0", uri: URI }]);
    expect(existsSync(join(data, "libraries", "drums"))).toBe(false);
    expect(existsSync(join(data, "libraries", "st0"))).toBe(true);
  });

  it("refuses a library its key cannot clone, storing nothing", async () => {
    const store = new LibraryStore(data);
    const r = await store.set([{ uri: "git@example.test:studio/gone.git" }]);
    expect("error" in r && r.error).toMatch(/deploy key/);
    expect(existsSync(join(data, "libraries.json"))).toBe(false);
  });

  it("reads the accounts' former lists, merged, until the origin has its own", () => {
    for (const [acct, list] of [
      ["a-1", { uri: URI }],
      [
        "b-2",
        {
          libraries: [
            { name: "drums", uri: OTHER },
            { name: "st0", uri: URI },
          ],
        },
      ],
    ] as const) {
      mkdirSync(join(data, acct), { recursive: true });
      writeFileSync(join(data, acct, "libraries.json"), JSON.stringify(list));
    }
    expect(new LibraryStore(data).settings()).toEqual([
      { name: "st0", uri: URI },
      { name: "drums", uri: OTHER },
    ]);
  });

  it("validates a list before anything is cloned", () => {
    expect(settingsProblem([{ name: "engine", uri: URI }])).toMatch(/engine/);
    expect(
      settingsProblem([
        { name: "a", uri: URI },
        { name: "b", uri: URI },
      ]),
    ).toMatch(/twice/);
    expect(settingsProblem([{ name: "a", uri: "/tmp/repo" }])).toMatch(/SSH/);
  });
});

describe("a pull's bench drop", () => {
  it("removes every idle account's bench clone of that library, and its mark as open", async () => {
    const bench = (account: string, lib: string) =>
      join(data, account, "bench-libraries", lib);
    for (const [a, lib] of [
      ["alice", "st0"],
      ["bob", "st0"],
      ["bob", "drums"],
    ]) {
      mkdirSync(bench(a, lib), { recursive: true });
      writeFileSync(join(bench(a, lib), "amp.yaml"), "unpushed\n");
    }
    writeFileSync(join(data, "alice", "bench-libraries", ".active"), "st0\n");
    writeFileSync(join(data, "bob", "bench-libraries", ".active"), "drums\n");
    await dropBenches(data, [], "st0", () => undefined);
    expect(existsSync(bench("alice", "st0"))).toBe(false);
    expect(existsSync(bench("bob", "st0"))).toBe(false);
    expect(existsSync(bench("bob", "drums"))).toBe(true);
    expect(existsSync(join(data, "alice", "bench-libraries", ".active"))).toBe(
      false,
    );
    expect(existsSync(join(data, "bob", "bench-libraries", ".active"))).toBe(
      true,
    );
  });
});
