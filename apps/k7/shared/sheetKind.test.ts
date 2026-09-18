// A score arrives with whatever media type the browser guessed; the extension is what decides.

import { describe, expect, it } from "vitest";
import {
  canonicalSheetMime,
  isScore,
  SHEET_ACCEPT,
  sheetExt,
  sheetKind,
} from "./sheetKind.ts";

describe("sheetKind", () => {
  it("reads PDFs and images off the media type", () => {
    expect(sheetKind("a.PDF", "application/pdf")).toBe("pdf");
    expect(sheetKind("a.png", "image/png")).toBe("image");
    expect(sheetKind("logo.svg", "image/svg+xml")).toBe("image");
  });

  it("reads scores off the extension, whatever the browser sent", () => {
    expect(sheetKind("part.mxl", "application/octet-stream")).toBe("score");
    expect(sheetKind("part.musicxml", "text/xml")).toBe("score");
    expect(sheetKind("Part.XML", "application/xml")).toBe("score");
    expect(sheetKind("riff.gp5", "")).toBe("score");
  });

  it("refuses anything else", () => {
    expect(sheetKind("setup.exe", "application/octet-stream")).toBeNull();
    expect(sheetKind("notes.txt", "text/plain")).toBeNull();
  });
});

describe("canonicalSheetMime", () => {
  it("stores a score under its own media type", () => {
    expect(canonicalSheetMime("p.mxl", "application/octet-stream")).toBe(
      "application/vnd.recordare.musicxml",
    );
    expect(canonicalSheetMime("p.musicxml", "text/xml")).toBe(
      "application/vnd.recordare.musicxml+xml",
    );
    expect(canonicalSheetMime("r.gpx", "")).toBe("application/x-guitar-pro");
  });

  it("keeps PDFs and images as sent, and refuses the rest", () => {
    expect(canonicalSheetMime("a.jpg", "image/jpeg")).toBe("image/jpeg");
    expect(canonicalSheetMime("x.exe", "application/x-msdownload")).toBeNull();
  });
});

describe("sheetExt", () => {
  it("names a cached copy by what it is", () => {
    expect(sheetExt("a.pdf", "application/pdf")).toBe("pdf");
    expect(sheetExt("a.jpeg", "image/jpeg")).toBe("jpg");
    expect(sheetExt("a.svg", "image/svg+xml")).toBe("svg");
    expect(sheetExt("p.MXL", "application/vnd.recordare.musicxml")).toBe("mxl");
    expect(sheetExt("mystery", "application/octet-stream")).toBe("bin");
  });
});

describe("the picker and the predicate", () => {
  it("offers every score extension", () => {
    for (const ext of [".musicxml", ".mxl", ".gp5"])
      expect(SHEET_ACCEPT.split(",")).toContain(ext);
  });

  it("tells a score from a sheet image", () => {
    expect(isScore({ name: "p.mxl", mime: "application/octet-stream" })).toBe(true);
    expect(isScore({ name: "p.png", mime: "image/png" })).toBe(false);
  });
});
