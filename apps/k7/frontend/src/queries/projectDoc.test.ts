// projectDoc.test.ts — a reload's compiled project keeps the identity of what did not change.

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const answers: unknown[] = [];
vi.mock("../api", () => ({
  api: { projectDoc: async () => answers.shift() },
}));
vi.mock("../state/shellStore", () => ({ useShell: () => "shell" }));

const { projectDocQuery } = await import("./projectDoc");

const doc = (gain: number) => ({
  tempo: 120,
  tracks: [
    { id: "a", gain, clips: [{ id: "a1", notes: [{ key: 60, time: 0 }] }] },
    { id: "b", gain: 1, clips: [{ id: "b1", notes: [{ key: 62, time: 1 }] }] },
  ],
});

describe("projectDocQuery", () => {
  it("keeps an unchanged clip's identity across a reload", async () => {
    const client = new QueryClient();
    answers.push(doc(1), doc(0.5));
    // biome-ignore lint/suspicious/noExplicitAny: the test documents are a sketch of WebProject
    const first: any = await client.fetchQuery(projectDocQuery("shell", 1));
    // biome-ignore lint/suspicious/noExplicitAny: same
    const second: any = await client.fetchQuery(projectDocQuery("shell", 2));
    expect(second).not.toBe(first);
    expect(second.tracks[0]).not.toBe(first.tracks[0]);
    expect(second.tracks[0].gain).toBe(0.5);
    expect(second.tracks[0].clips).toBe(first.tracks[0].clips);
    expect(second.tracks[1]).toBe(first.tracks[1]);
  });

  it("answers a new root for an unchanged document, every part shared", async () => {
    const client = new QueryClient();
    answers.push(doc(1), doc(1));
    // biome-ignore lint/suspicious/noExplicitAny: same
    const a: any = await client.fetchQuery(projectDocQuery("shell", 1));
    // biome-ignore lint/suspicious/noExplicitAny: same
    const b: any = await client.fetchQuery(projectDocQuery("shell", 2));
    expect(b).not.toBe(a);
    expect(b.tracks).toBe(a.tracks);
  });

  it("shares nothing across scopes", async () => {
    const client = new QueryClient();
    answers.push(doc(1), doc(1));
    // biome-ignore lint/suspicious/noExplicitAny: same
    const a: any = await client.fetchQuery(projectDocQuery("shell", 1));
    // biome-ignore lint/suspicious/noExplicitAny: same
    const b: any = await client.fetchQuery(projectDocQuery("device", 2));
    expect(b.tracks[1]).not.toBe(a.tracks[1]);
  });
});
