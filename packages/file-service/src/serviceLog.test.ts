// serviceLog.test.ts — the Logs panel's file-service half: what `console` writes is kept, numbered,
// and handed out by "since N". What would be wrong silently: a cursor from a restarted process
// answering nothing forever, and the buffer growing without end on a service that runs for weeks.

import { describe, expect, it, vi } from "vitest";
import {
  installServiceLog,
  keepServiceLine,
  SERVICE_LOG_LINES,
  serviceLogSince,
} from "./serviceLog.ts";

describe("serviceLog", () => {
  it("keeps what console writes, still writing it where it went before", () => {
    const original = vi.spyOn(console, "warn").mockImplementation(() => {});
    installServiceLog();
    const before = serviceLogSince().seq;
    console.warn("heartbeat from %s refused", "e1");
    const got = serviceLogSince(before);
    expect(got.lines).toEqual([
      expect.objectContaining({
        level: "warn",
        text: "heartbeat from e1 refused",
      }),
    ]);
    expect(original).toHaveBeenCalledWith("heartbeat from %s refused", "e1");
    original.mockRestore();
  });

  it("answers only what came after the cursor", () => {
    keepServiceLine("info", "a");
    const at = serviceLogSince().seq;
    keepServiceLine("info", "b");
    keepServiceLine("error", "c");
    expect(serviceLogSince(at).lines.map((l) => l.text)).toEqual(["b", "c"]);
    expect(serviceLogSince(serviceLogSince().seq).lines).toEqual([]);
  });

  it("answers from the start to a cursor from a PREVIOUS process, rather than nothing forever", () => {
    keepServiceLine("info", "after a restart");
    const r = serviceLogSince(Number.MAX_SAFE_INTEGER, 1);
    expect(r.lines.map((l) => l.text)).toEqual(["after a restart"]);
  });

  it("keeps a bounded number of lines", () => {
    for (let i = 0; i < SERVICE_LOG_LINES + 50; i++)
      keepServiceLine("info", `l${i}`);
    const all = serviceLogSince(0).lines;
    expect(all).toHaveLength(SERVICE_LOG_LINES);
    expect(all.at(-1)?.text).toBe(`l${SERVICE_LOG_LINES + 49}`);
  });
});
