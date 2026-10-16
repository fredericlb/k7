// What the realtime loop may skip: the upload memo and the draw gate, with no GL and no DOM.

import { describe, expect, it } from "vitest";
import {
  DrawGate,
  STILL_STAMP,
  UploadMemo,
  type VideoLike,
  videoStamp,
} from "./frameGate";

const video = (over: Partial<VideoLike> = {}): VideoLike => ({
  currentSrc: "a.mp4",
  currentTime: 1,
  readyState: 4,
  seeking: false,
  ...over,
});

describe("videoStamp", () => {
  it("is null mid-seek, when the element still holds the old frame", () => {
    expect(videoStamp(video({ seeking: true }))).toBeNull();
  });

  it("changes with the position, the source and readiness", () => {
    const base = videoStamp(video());
    expect(videoStamp(video({ currentTime: 1.033 }))).not.toBe(base);
    expect(videoStamp(video({ currentSrc: "b.mp4" }))).not.toBe(base);
    expect(videoStamp(video({ readyState: 1 }))).not.toBe(base);
    expect(videoStamp(video())).toBe(base);
  });
});

describe("UploadMemo", () => {
  it("uploads a still once, plus the one trailing upload, then never again", () => {
    const m = new UploadMemo();
    const img = {};
    expect(m.need("l", 0, img, STILL_STAMP)).toBe(true);
    expect(m.need("l", 0, img, STILL_STAMP)).toBe(true);
    for (let i = 0; i < 5; i++)
      expect(m.need("l", 0, img, STILL_STAMP)).toBe(false);
  });

  it("uploads again when the picture changes — another cue, another position", () => {
    const m = new UploadMemo();
    const a = {};
    const b = {};
    m.need("l", 0, a, STILL_STAMP);
    m.need("l", 0, a, STILL_STAMP);
    expect(m.need("l", 0, b, STILL_STAMP)).toBe(true);
    const el = {};
    m.need("v", 0, el, "x@1");
    m.need("v", 0, el, "x@1");
    expect(m.need("v", 0, el, "x@1")).toBe(false);
    expect(m.need("v", 0, el, "x@1.5")).toBe(true);
  });

  it("keeps each slot apart: the same element in the other slot is a new upload", () => {
    const m = new UploadMemo();
    const el = {};
    m.need("l", 0, el, "s");
    m.need("l", 0, el, "s");
    expect(m.need("l", 1, el, "s")).toBe(true);
    expect(m.need("k", 0, el, "s")).toBe(true);
  });

  it("always uploads a null stamp — a camera, or a seek in flight", () => {
    const m = new UploadMemo();
    const el = {};
    for (let i = 0; i < 4; i++) expect(m.need("cam", 0, el, null)).toBe(true);
  });

  it("uploads everything again after forget", () => {
    const m = new UploadMemo();
    const img = {};
    m.need("l", 0, img, STILL_STAMP);
    m.need("l", 0, img, STILL_STAMP);
    m.forget();
    expect(m.need("l", 0, img, STILL_STAMP)).toBe(true);
  });
});

describe("DrawGate", () => {
  it("draws the first frame, then only when the key moves", () => {
    const g = new DrawGate();
    expect(g.need(false, false, "k")).toBe(true);
    expect(g.need(false, false, "k")).toBe(false);
    expect(g.need(false, false, "k2")).toBe(true);
  });

  it("draws whenever something was uploaded or the transport runs", () => {
    const g = new DrawGate();
    g.need(false, false, "k");
    expect(g.need(true, false, "k")).toBe(true);
    expect(g.need(false, true, "k")).toBe(true);
    expect(g.need(false, false, "k")).toBe(false);
  });

  it("draws again after invalidate", () => {
    const g = new DrawGate();
    g.need(false, false, "k");
    g.invalidate();
    expect(g.need(false, false, "k")).toBe(true);
  });
});
