import type { MediatekEntry } from "@studio/mediatek/types";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { createTapper, DOUBLE_TAP_MS } from "./useSongTap";

const song = (name: string, master: string | null = "master.mp3") =>
  ({
    family: "songs",
    name,
    path: `songs/${name}`,
    meta: master ? { master } : {},
  }) as unknown as MediatekEntry;

let open: Mock<(entry: MediatekEntry) => void>;
let play: Mock<(entry: MediatekEntry, master: string) => void>;
const tapper = (touch: boolean) =>
  createTapper({ open, play, touch: () => touch });

beforeEach(() => {
  vi.useFakeTimers();
  open = vi.fn();
  play = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe("a tap on a song", () => {
  it("opens at once under a mouse", () => {
    tapper(false).tap(song("a"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens once the double-tap window has passed on a touch screen", () => {
    const t = tapper(true);
    t.tap(song("a"));
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });

  it("plays the master, and opens nothing, when tapped twice", () => {
    const t = tapper(true);
    t.tap(song("a"));
    t.tap(song("a"));
    vi.advanceTimersByTime(DOUBLE_TAP_MS * 2);
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ name: "a" }),
      "master.mp3",
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the second song when two different songs are tapped", () => {
    const t = tapper(true);
    t.tap(song("a"));
    t.tap(song("b"));
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ name: "b" }));
    expect(play).not.toHaveBeenCalled();
  });

  it("opens at once a song with no master, since there is nothing to play", () => {
    tapper(true).tap(song("a", null));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens nothing after it is disposed", () => {
    const t = tapper(true);
    t.tap(song("a"));
    t.dispose();
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(open).not.toHaveBeenCalled();
  });
});
