/**
 * The bug these exist for: st0 renamed a command, saved, reloaded, and read the catalogue's own
 * names back. Its `prefsSchema` still said "one field so far: the engine they drive", a zod
 * object strips what it does not declare, and the PUT answered `{ok:true}` either way — so a
 * whole layer of preferences was accepted and thrown away, with nothing anywhere saying so.
 *
 * The schema staying the host's is right (`docs/store.md`); silence when it falls behind is not.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { droppedKeys } from "./router.ts";

const SCHEMA = z.object({ engineId: z.string().optional() });
const keep = (body: unknown) => SCHEMA.parse(body);

describe("what a schema silently threw away", () => {
  it("names the field a service forgot to declare", () => {
    const sent = { engineId: "e1", commands: { "clip trim": { icon: "X" } } };
    expect(droppedKeys(sent, keep(sent))).toEqual(["commands"]);
  });

  it("says nothing when everything sent was kept", () => {
    const sent = { engineId: "e1" };
    expect(droppedKeys(sent, keep(sent))).toEqual([]);
    expect(droppedKeys({}, keep({}))).toEqual([]);
  });

  it("lists every one of them, since a service may be several fields behind", () => {
    const sent = { engineId: "e1", commands: {}, layout: "wide" };
    expect(droppedKeys(sent, keep(sent)).sort()).toEqual([
      "commands",
      "layout",
    ]);
  });

  // A declared field the person has CLEARED is absent from both sides, and is not a loss.
  it("does not call an absent optional field a loss", () => {
    expect(droppedKeys({}, keep({ engineId: undefined }))).toEqual([]);
  });

  it("answers nothing for a body that is not an object at all", () => {
    // Belt and braces: the schema would refuse these first, and the route asks this second.
    expect(droppedKeys(null, {})).toEqual([]);
    expect(droppedKeys("nope", {})).toEqual([]);
    expect(droppedKeys({ a: 1 }, null)).toEqual([]);
  });
});
