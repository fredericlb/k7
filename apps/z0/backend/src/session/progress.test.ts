import { describe, expect, it } from "vitest";
import type { Session, Song } from "./model.ts";
import { emptySession, SessionProgress } from "./progress.ts";

const song = (title: string): Song => ({ artist: "A", title });

const session = (): Session => ({
  categories: [
    {
      name: "Rock",
      mode: "",
      illustration: "",
      songs: [song("r1"), song("r2")],
    },
    {
      name: "Pop",
      mode: "free",
      illustration: "",
      songs: [song("p1"), song("p2"), song("p3")],
    },
    { name: "Empty", mode: "", illustration: "", songs: [] },
  ],
  order: [
    { cat: "Rock" },
    { type: "pause" },
    { cat: "Pop", from: 1, to: 3 }, // slice: p2, p3
    { cat: "Empty" }, // no songs — skipped
  ],
});

describe("SessionProgress.next", () => {
  it("walks intro → songs → pause → sliced slot → end", () => {
    const sp = new SessionProgress(session());
    expect(sp.current()).toBeNull(); // not started

    expect(sp.next()).toMatchObject({ type: "category", categoryName: "Rock" });
    expect(sp.next()).toMatchObject({ type: "song", song: { title: "r1" } });
    expect(sp.next()).toMatchObject({ type: "song", song: { title: "r2" } });
    expect(sp.next()).toMatchObject({
      type: "category",
      categoryName: "Pause",
      mode: "pause",
    });
    // Pop sliced to [1,3) → p2, p3
    expect(sp.next()).toMatchObject({
      type: "category",
      categoryName: "Pop",
      mode: "free",
    });
    expect(sp.next()).toMatchObject({ type: "song", song: { title: "p2" } });
    expect(sp.next()).toMatchObject({ type: "song", song: { title: "p3" } });
    // Empty slot is skipped entirely.
    expect(sp.next()).toMatchObject({ type: "end", finished: true });
    expect(sp.next()).toMatchObject({ type: "end", finished: true }); // stays ended
  });

  it("synthesizes an order for legacy sessions without one", () => {
    const s = session();
    delete s.order;
    const sp = new SessionProgress(s);
    expect(sp.next()).toMatchObject({ type: "category", categoryName: "Rock" });
    expect(sp.totalSongs()).toBe(5); // 2 + 3 + 0, no slicing
  });

  it("category intros carry the sliced song list", () => {
    const sp = new SessionProgress(session());
    sp.next(); // Rock intro
    sp.next(); // r1
    sp.next(); // r2
    sp.next(); // pause
    const intro = sp.next(); // Pop intro
    expect(intro.category?.songs.map((s) => s.title)).toEqual(["p2", "p3"]);
  });
});

describe("current / peek", () => {
  it("current reflects position without advancing", () => {
    const sp = new SessionProgress(session());
    sp.next(); // Rock intro
    expect(sp.current()).toMatchObject({
      type: "category",
      categoryName: "Rock",
    });
    sp.next(); // r1
    expect(sp.current()).toMatchObject({ type: "song", song: { title: "r1" } });
    expect(sp.current()).toMatchObject({ type: "song", song: { title: "r1" } }); // stable
  });

  it("peek previews the next item without advancing", () => {
    const sp = new SessionProgress(session());
    expect(sp.peek()).toMatchObject({ type: "category", categoryName: "Rock" });
    sp.next(); // Rock intro
    expect(sp.peek()).toMatchObject({ type: "song", songTitle: "r1" });
    sp.next(); // r1
    expect(sp.peek()).toMatchObject({ type: "song", songTitle: "r2" });
    sp.next(); // r2 — slot exhausted
    expect(sp.peek()).toMatchObject({
      type: "category",
      categoryName: "Pause",
    });
    const snap = sp.snapshot();
    expect(snap).toMatchObject({ started: true, finished: false });
  });

  it("peek falls back to the first track's artist/title", () => {
    const s: Session = {
      categories: [
        {
          name: "Fusion",
          mode: "fusion",
          illustration: "",
          songs: [
            { artist: "", title: "", tracks: [{ artist: "TA", title: "TT" }] },
          ],
        },
      ],
    };
    const sp = new SessionProgress(s);
    sp.next(); // intro
    expect(sp.peek()).toMatchObject({
      type: "song",
      songArtist: "TA",
      songTitle: "TT",
    });
  });
});

describe("skip / snapshot / restore", () => {
  it("skipToNextCategory jumps to the next slot's intro", () => {
    const sp = new SessionProgress(session());
    sp.next(); // Rock intro
    sp.next(); // r1
    expect(sp.skipToNextCategory()).toBe(true);
    expect(sp.next()).toMatchObject({
      type: "category",
      categoryName: "Pause",
    });
  });

  it("skip past the last slot finishes the session", () => {
    const sp = new SessionProgress({
      categories: [
        { name: "Only", mode: "", illustration: "", songs: [song("x")] },
      ],
    });
    sp.next();
    expect(sp.skipToNextCategory()).toBe(false);
    expect(sp.next()).toMatchObject({ type: "end", finished: true });
  });

  it("snapshot/restore round-trips the position", () => {
    const sp = new SessionProgress(session());
    sp.next(); // Rock intro
    sp.next(); // r1
    const snap = sp.snapshot();

    const sp2 = new SessionProgress(session());
    sp2.restore(snap.orderIndex, snap.songIndex, snap.started, snap.finished);
    expect(sp2.current()).toMatchObject({
      type: "song",
      song: { title: "r1" },
    });
    expect(sp2.next()).toMatchObject({ type: "song", song: { title: "r2" } });
  });

  it("empty session ends immediately and exposes guestPassword", () => {
    const sp = new SessionProgress(emptySession());
    expect(sp.guestPassword()).toBe("");
    expect(sp.totalSongs()).toBe(0);
    expect(sp.next()).toMatchObject({ type: "end", finished: true });
  });
});
