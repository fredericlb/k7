import { describe, expect, it } from "vitest";
import { failed, HttpError, readJson } from "./call";

const answer = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("failed", () => {
  it("carries the server's sentence and the status", async () => {
    const e = await failed(answer(404, { error: "no such song" }), "song");
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).toBe("no such song");
    expect(e.status).toBe(404);
  });

  it("falls back on the caller's word and the status, or its own sentence", async () => {
    expect((await failed(answer(500, undefined), "mkdir")).message).toBe(
      "mkdir 500",
    );
    const said = await failed(answer(502, {}), (s) => `failed (${s})`);
    expect(said.message).toBe("failed (502)");
  });
});

describe("readJson", () => {
  it("reads a success and throws a refusal", async () => {
    expect(await readJson(answer(200, { ok: 1 }), "x")).toEqual({ ok: 1 });
    await expect(
      readJson(answer(409, { error: "exists" }), "x"),
    ).rejects.toThrow("exists");
  });
});
