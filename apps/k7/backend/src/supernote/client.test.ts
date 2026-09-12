// The protocol, against a stubbed fetch. What this pins is the SHAPE of every request —
// the field names came off a live server and a rename would break the sync silently.

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureFolderPath,
  listDirectory,
  login,
  rerootUpload,
  uploadFile,
} from "./client.ts";

const BASE = "https://cloud.example";
const session = { baseUrl: BASE, token: "jwt" };

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Answers each call in turn, and records what was asked. */
function stubFetch(answers: unknown[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body:
        typeof init?.body === "string" ? JSON.parse(init.body) : { form: true },
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const answer = answers[i++] ?? { success: true };
    return { ok: true, status: 200, json: async () => answer } as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("login", () => {
  it("sends sha256(md5(password) + randomCode), never the password", async () => {
    const calls = stubFetch([
      { success: true, randomCode: "CODE", timestamp: 1234 },
      { success: true, token: "jwt" },
    ]);

    const result = await login(`${BASE}/`, "me@example.com", "hunter2");

    expect(result).toEqual({ baseUrl: BASE, token: "jwt" });
    expect(calls[0].url).toBe(`${BASE}/api/official/user/query/random/code`);
    expect(calls[0].body).toEqual({
      countryCode: null,
      account: "me@example.com",
    });

    const expected = createHash("sha256")
      .update(`${createHash("md5").update("hunter2").digest("hex")}CODE`)
      .digest("hex");
    expect(calls[1].url).toBe(`${BASE}/api/official/user/account/login/new`);
    expect(calls[1].body.password).toBe(expected);
    expect(JSON.stringify(calls[1].body)).not.toContain("hunter2");
    expect(calls[1].body.timestamp).toBe(1234);
    expect(calls[1].body.equipment).toBe("1");
  });

  it("raises the server's own message", async () => {
    stubFetch([{ success: false, errorMsg: "Account does not exist" }]);
    await expect(login(BASE, "nobody", "x")).rejects.toThrow(
      "Account does not exist",
    );
  });
});

describe("listDirectory", () => {
  it("keeps asking while a page comes back full", async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${i}`,
        fileName: `f${i}`,
        isFolder: "N",
      }));
    stubFetch([
      { success: true, userFileVOList: page(100) },
      { success: true, userFileVOList: page(3) },
    ]);

    expect(await listDirectory(session, "0")).toHaveLength(103);
  });

  it("reads a folder off the Y, and carries the token", async () => {
    const calls = stubFetch([
      {
        success: true,
        userFileVOList: [{ id: "7", fileName: "Document", isFolder: "Y" }],
      },
    ]);

    expect(await listDirectory(session, "0")).toEqual([
      { id: "7", fileName: "Document", isFolder: true },
    ]);
    expect(calls[0].headers["x-access-token"]).toBe("jwt");
    expect(calls[0].body).toMatchObject({ directoryId: "0", pageNo: 1 });
  });
});

describe("ensureFolderPath", () => {
  it("walks what is there and creates only what is missing", async () => {
    const calls = stubFetch([
      // Document exists at the root…
      {
        success: true,
        userFileVOList: [{ id: "7", fileName: "Document", isFolder: "Y" }],
      },
      // …but Songbook is not in it yet.
      { success: true, userFileVOList: [] },
      { success: true },
      {
        success: true,
        userFileVOList: [{ id: "9", fileName: "Songbook", isFolder: "Y" }],
      },
    ]);

    expect(await ensureFolderPath(session, "Document/Songbook")).toBe("9");
    expect(calls[2].url).toBe(`${BASE}/api/file/folder/add`);
    expect(calls[2].body).toEqual({ directoryId: "7", fileName: "Songbook" });
  });
});

describe("uploadFile", () => {
  it("applies, posts the bytes to the granted URL, then finishes", async () => {
    const calls = stubFetch([
      { success: true, fullUploadUrl: `${BASE}/oss/put`, innerName: "inner-1" },
      { success: true },
      { success: true },
    ]);
    const bytes = new Uint8Array([1, 2, 3]);
    const md5 = createHash("md5").update(bytes).digest("hex");

    await uploadFile(session, "9", "A - B.epub", bytes);

    expect(calls[0].url).toBe(`${BASE}/api/file/upload/apply`);
    expect(calls[0].body).toEqual({
      size: 3,
      fileName: "A - B.epub",
      directoryId: "9",
      md5,
    });
    // apply is the one call the server wants a nonce on, tied to the timestamp sent with it.
    expect(calls[0].headers.nonce).toBe(
      `${calls[0].headers.nonce.slice(0, 10)}${calls[0].headers.timestamp}`,
    );

    expect(calls[1].url).toBe(`${BASE}/oss/put`);
    expect(calls[2].url).toBe(`${BASE}/api/file/upload/finish`);
    expect(calls[2].body).toEqual({
      directoryId: "9",
      fileName: "A - B.epub",
      fileSize: 3,
      innerName: "inner-1",
      md5,
    });
  });

  it("stops when the server grants no URL", async () => {
    stubFetch([{ success: true }]);
    await expect(
      uploadFile(session, "9", "x.epub", new Uint8Array([1])),
    ).rejects.toThrow("no upload URL");
  });
});

describe("rerootUpload", () => {
  const under = "https://media.example.com/priv/supernote";

  it("puts back the path prefix the server does not know it has", () => {
    expect(
      rerootUpload(
        under,
        "https://media.example.com:443/api/oss/upload?signature=abc&path=x",
      ),
    ).toBe(`${under}/api/oss/upload?signature=abc&path=x`);
  });

  it("leaves a URL that already carries the prefix alone", () => {
    const granted = `${under}/api/oss/upload?signature=abc`;
    expect(rerootUpload(under, granted)).toBe(granted);
  });

  it("leaves a server mounted at a root alone, whatever host it names", () => {
    const granted = "https://storage.example.net/bucket/put?sig=1";
    expect(rerootUpload("https://cloud.example.com", granted)).toBe(granted);
  });
});
