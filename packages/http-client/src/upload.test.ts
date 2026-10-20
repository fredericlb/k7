import { afterEach, describe, expect, it, vi } from "vitest";
import { upload } from "./upload";

// An XMLHttpRequest that sends its body in two halves, then answers what the test set.
let answer = { status: 201, body: '{"ok":true}' };
class FakeXhr {
  upload: {
    onprogress?: (e: Partial<ProgressEvent>) => void;
    onload?: () => void;
  } = {};
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  responseType = "";
  status = 0;
  statusText = "";
  response: Blob | null = null;
  open() {}
  setRequestHeader() {}
  getResponseHeader() {
    return "application/json";
  }
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    this.upload.onload?.();
    this.status = answer.status;
    this.response = new Blob([answer.body]);
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("upload", () => {
  it("reports the share sent and answers a Response read like a fetch's", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    answer = { status: 201, body: '{"ok":true}' };
    const seen: number[] = [];
    const res = await upload("/x", {
      body: "abc",
      onProgress: (f) => seen.push(f),
    });
    expect(seen).toEqual([0.5, 1, 1]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers a 204 with no body rather than throwing", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    answer = { status: 204, body: "" };
    const res = await upload("/x", { body: "abc" });
    expect(res.status).toBe(204);
  });

  it("refuses at once a signal already aborted", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      upload("/x", { body: "abc", signal: ctl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
