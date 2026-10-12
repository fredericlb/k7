import { describe, expect, it } from "vitest";
import { looksLikeTabLine, parseTablature, type TabNode } from "./tab";

describe("looksLikeTabLine", () => {
  it("accepts real tab string lines", () => {
    for (const l of [
      "e|--0--2--3--|",
      "G|-0-2-0-h2-|",
      "|---5---7---|",
      "D|--12--10--|",
      // label-less lines with let-ring (L) and grace/legato (g) techniques
      "--4-----------4-----------4-----------4L----4-------|",
      "-----2-----------4----------|--2s-4g-5-------|",
    ]) {
      expect(looksLikeTabLine(l), l).toBe(true);
    }
  });

  it("rejects prose, chord lines and section labels", () => {
    for (const l of [
      "Hello darkness my old friend",
      "C   G   Am   F",
      "[Verse 1]",
      "Chorus:",
    ]) {
      expect(looksLikeTabLine(l), l).toBe(false);
    }
  });
});

const sys = (nodes: TabNode[]) => nodes.find((n) => n.type === "system");

describe("parseTablature", () => {
  const TAB = [
    "[Intro]",
    "e|--0--2--3--|",
    "B|--1--1--0--|",
    "G|--0--2--0--|",
    "D|--2--2--0--|",
    "A|--3-----2--|",
    "E|--------3--|",
    "",
    "let ring",
  ].join("\n");

  it("groups the six string lines into one system", () => {
    const s = sys(parseTablature(TAB));
    expect(s?.type).toBe("system");
    if (s?.type === "system") {
      expect(s.strings.length).toBe(6);
      expect(s.strings[0].label).toBe("e");
    }
  });

  it("classifies section, empty and text lines around the system", () => {
    const nodes = parseTablature(TAB);
    expect(nodes[0]).toEqual({ type: "section", label: "Intro" });
    expect(nodes.some((n) => n.type === "empty")).toBe(true);
    expect(nodes[nodes.length - 1]).toEqual({ type: "text", text: "let ring" });
  });

  it("places multi-digit frets at their starting column and collects bars", () => {
    const s = sys(parseTablature("D|--12--10--|"));
    if (s?.type === "system") {
      const frets = s.strings[0].events.filter((e) => e.kind === "fret");
      expect(frets.map((f) => f.text)).toEqual(["12", "10"]);
      // body "|--12..." -> the leading "|" is column 0, so "12" starts at column 3.
      expect(frets[0].col).toBe(3);
      expect(s.bars.length).toBeGreaterThan(0);
    }
  });

  it("keeps a standard-tuning system whole despite the duplicate E labels", () => {
    // High and low strings are both labelled "E" — must not split the 6th string off.
    const text = [
      "E |--------------------|",
      "B |--------3-----2-----|",
      "G |--------4-----4-----|",
      "D |-----4--------5-----|",
      "A |--2--------2--------|",
      "E |--------2-----------|",
    ].join("\n");
    const systems = parseTablature(text).filter((n) => n.type === "system");
    expect(systems.length).toBe(1);
    if (systems[0].type === "system") expect(systems[0].strings.length).toBe(6);
  });

  it("recognizes label-less strings with L/g techniques as part of the system", () => {
    const text = [
      "--3-----------------------0-----------3L----3--2----|",
      "--4-----------4-----------4-----------4L----4-------|",
      "--------4-------------------------------------------|",
      "--2-----------------------------2-------------------|",
      "--------------------------2-------------------------|",
      "--0-----------2-------------------------------------|",
    ].join("\n");
    const systems = parseTablature(text).filter((n) => n.type === "system");
    expect(systems.length).toBe(1);
    if (systems[0].type === "system") expect(systems[0].strings.length).toBe(6);
  });

  it("parses the full real-world example into 5 six-string systems, no text", () => {
    const text = [
      "E |----------------------------|----------------------------|",
      "B |--------3-----------2-------|--------0-----------2-------|",
      "G |--------4-----------4-------|--------0-----------2-------|",
      "D |-----4--------------5-------|--------2-----------2-------|",
      "A |--2--------------2----------|-----2-----------4----------|",
      "E |--------------2-------------|--0-----------2-------------|",
      "",
      "----------------------------------------------------|",
      "--3-----------------------0-----------3L----3--2----|",
      "--4-----------4-----------4-----------4L----4-------|",
      "--------4-------------------------------------------|",
      "--2-----------------------------2-------------------|",
      "--------------------------2-------------------------|",
      "",
      "--0-----------2-------------|----------------|",
      "-----------3----------------|--3--5--7--5----|",
      "--------------------2-------|--4--6--7--6----|",
      "--------4-----------2-------|--------5-------|",
      "-----2-----------4----------|--2s-4g-5-------|",
      "--0-----------2-------------|----------------|",
      "",
      "-----------------------0--------------0g------------|",
      "--5-----------3L----3--2--2-----------2g------------|",
      "--6-----------4L----4-----3-------------------------|",
      "--------------------------------4g------------------|",
      "--------------------------1-------------------------|",
      "--0-----------2L----2-------------------------------|",
      "",
      "--------------------3-----------------2-----3-------|",
      "--3-----------------3-----3-------------------------|",
      "--4-----------4--------6--6g------------------------|",
      "--------4-----------------------4-------------------|",
      "--2-------------------------------------------------|",
      "--------------------------3-------------------------|",
    ].join("\n");
    const nodes = parseTablature(text);
    const systems = nodes.filter((n) => n.type === "system");
    expect(systems.length).toBe(5);
    for (const s of systems)
      if (s.type === "system") expect(s.strings.length).toBe(6);
    expect(nodes.some((n) => n.type === "text")).toBe(false);
  });

  it("captures techniques as non-fret events", () => {
    const s = sys(parseTablature("G|-0-2-0h2-|"));
    if (s?.type === "system") {
      expect(
        s.strings[0].events.some(
          (e) => e.kind === "technique" && e.text === "h",
        ),
      ).toBe(true);
    }
  });
});
