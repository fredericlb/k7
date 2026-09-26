// The chain source finds the engine by the claim st0 takes on the bench address — the one
// agreement between the two apps, so it is pinned here against the address reader itself.

import type { PublicEngine } from "@studio/web-protocol";
import {
  BENCH_REPO,
  benchChainOf,
  parseLaunch,
  projectClaimKey,
} from "@studio/web-protocol/projects";
import { describe, expect, it } from "vitest";
import { benchClaim, holderOf, isLocalEngine } from "./chainSource";

const engine = (over: Partial<PublicEngine>): PublicEngine => ({
  id: "e1",
  hostname: "studio-box",
  addresses: {} as PublicEngine["addresses"],
  assigned: true,
  sameSourceIp: false,
  ...over,
});

describe("the chain source", () => {
  it("names the claim st0 takes when it opens the bench on that chain", () => {
    const at = parseLaunch(`/${BENCH_REPO}/vocals/warm/live.st0`, "st0", "/");
    expect(at && projectClaimKey(at)).toBe(benchClaim("vocals/warm"));
    expect(benchChainOf(at?.project ?? "")).toBe("vocals/warm");
  });

  it("follows the engine holding that claim for this account, and no other", () => {
    const claim = benchClaim("vocals/warm");
    const list = [
      engine({ id: "song", heldProject: "@local/ws/song.st0", heldBy: "me@x" }),
      engine({ id: "theirs", heldProject: claim, heldBy: "them@x" }),
      engine({ id: "mine", heldProject: claim, heldBy: "me@x" }),
    ];
    expect(holderOf(list, claim, "me@x")?.id).toBe("mine");
    expect(holderOf(list.slice(0, 2), claim, "me@x")).toBeUndefined();
  });

  it("tells this machine's engine from one heard over the network", () => {
    expect(isLocalEngine("ws://127.0.0.1:8790/?token=t")).toBe(true);
    expect(isLocalEngine("ws://localhost:8790")).toBe(true);
    expect(isLocalEngine("wss://play.st0.app/api/engine/e1/ws")).toBe(false);
    expect(isLocalEngine("rtc:e1")).toBe(false);
  });
});
