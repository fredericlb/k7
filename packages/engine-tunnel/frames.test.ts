// frames.test.ts — a tunnel needs no account, so whatever arrives on one is checked for shape
// before anything reads it: a frame that is JSON but not a message must never reach a field.

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import {
  asBinaryHeader,
  binaryFrameType,
  decodeBinary,
  encodeBinary,
  parseAgentMessage,
  textFrameType,
} from "./frames.ts";
import { HubTunnel } from "./hubTunnel.ts";

/** A binary frame whose header is whatever JSON text is given. */
const rawBinary = (header: string, payload = "x"): Buffer => {
  const head = Buffer.from(header, "utf8");
  const out = Buffer.alloc(4 + head.length);
  out.writeUInt32BE(head.length, 0);
  head.copy(out, 4);
  return Buffer.concat([out, Buffer.from(payload)]);
};

/** A hub tunnel over a socket that only records what it is sent. */
function fakeTunnel(log: (msg: string) => void = () => {}) {
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    sent: [] as unknown[],
    send(d: unknown) {
      this.sent.push(d);
    },
    terminate() {
      this.readyState = 3;
    },
  });
  const t = new HubTunnel("e1", ws as unknown as WebSocket, log);
  return { ws, t };
}

const BAD = ["null", "1", '"x"', '{"t":1}', "[]", '{"t":"data"}', "not json"];

describe("parseAgentMessage", () => {
  it.each(BAD)("refuses %s", (text) => {
    expect(parseAgentMessage(text)).toBeNull();
  });

  it("refuses a stat whose paths are not an array of strings", () => {
    expect(
      parseAgentMessage('{"t":"stat","req":1,"ch":1,"paths":"a"}'),
    ).toBeNull();
    expect(
      parseAgentMessage('{"t":"stat","req":1,"ch":1,"paths":[1]}'),
    ).toBeNull();
  });

  it("takes every well-formed message", () => {
    for (const m of [
      { t: "opened", ch: 1 },
      { t: "close", ch: 1, reason: "bye" },
      { t: "data", ch: 1, text: "{}" },
      { t: "stat", req: 1, ch: 1, paths: ["a"] },
      { t: "get", req: 1, ch: 1, path: "a" },
      { t: "rtc-answer", req: 1, sdp: "v=0" },
    ])
      expect(parseAgentMessage(JSON.stringify(m))).toEqual(m);
  });
});

describe("binary headers", () => {
  it.each(["null", "1", '"x"', '{"t":1}', '{"t":"put","req":1}'])(
    "refuses the header %s",
    (h) => {
      expect(decodeBinary(rawBinary(h))).toBeNull();
    },
  );

  it("round-trips every header kind", () => {
    for (const h of [
      { t: "data", ch: 2 },
      { t: "chunk", req: 3, last: true },
      { t: "put", req: 4, ch: 2, path: "/a", last: false },
    ] as const) {
      expect(asBinaryHeader(h)).toEqual(h);
      expect(decodeBinary(encodeBinary(h, Buffer.from("p")))?.header).toEqual(
        h,
      );
    }
  });
});

describe("a hub tunnel fed garbage", () => {
  it("survives every malformed text frame, and keeps the socket", () => {
    const { ws, t } = fakeTunnel();
    for (const text of BAD)
      expect(() => ws.emit("message", Buffer.from(text), false)).not.toThrow();
    expect(() =>
      t.onText('{"t":"stat","req":1,"ch":1,"paths":5}'),
    ).not.toThrow();
    expect(ws.readyState).toBe(1);
    expect(ws.sent).toEqual([]);
  });

  it("survives a binary frame whose header is null", () => {
    const { ws } = fakeTunnel();
    expect(() => ws.emit("message", rawBinary("null"), true)).not.toThrow();
    expect(() => ws.emit("message", Buffer.from([0, 0]), true)).not.toThrow();
    expect(ws.readyState).toBe(1);
  });
});

describe("the type of a frame nobody reads", () => {
  it("names a text frame by its `t`, or says why it has none", () => {
    expect(textFrameType('{"t":"future"}')).toBe("future");
    expect(textFrameType('{"x":1}')).toBe("(no type)");
    expect(textFrameType("[]")).toBe("(not a JSON object)");
    expect(textFrameType("nope")).toBe("(not JSON)");
  });

  it("names a binary frame by its header's `t`", () => {
    expect(binaryFrameType(rawBinary('{"t":"later"}'))).toBe("later");
    expect(binaryFrameType(Buffer.from([0, 0]))).toBe("(too short)");
    expect(binaryFrameType(Buffer.from([0, 0, 0, 9, 1]))).toBe(
      "(header past the end)",
    );
  });

  it("is logged once per type by the hub, never once per frame", () => {
    const lines: string[] = [];
    const { ws } = fakeTunnel((m) => lines.push(m));
    for (let i = 0; i < 3; i++) {
      ws.emit("message", Buffer.from('{"t":"future","ch":1}'), false);
      ws.emit("message", rawBinary('{"t":"later"}'), true);
    }
    ws.emit("message", Buffer.from('{"t":"other"}'), false);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("'future'");
    expect(lines[1]).toContain("'later'");
    expect(lines[2]).toContain("'other'");
    expect(ws.readyState).toBe(1);
  });
});
