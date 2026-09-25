// owner.test.ts — a root has ONE owner: the first account claims it, the record survives a
// restart, and every other account is refused at the gate while the machine's own routes are
// not this file's business. docs/owner.md is the prose.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionOf } from "./engineLink.ts";
import {
  claimRoot,
  ownerPath,
  requireRootOwner,
  rootOwner,
  workspaceGate,
} from "./owner.ts";
import { rootDir } from "./slug.ts";

beforeEach(() => {
  process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "owner-"));
});

/** Run the gate on a request from `email`; answers whether it passed, and the status if not. */
function gate(email: string): { passed: boolean; status?: number } {
  let passed = false;
  let status: number | undefined;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  requireRootOwner({ userEmail: email } as Request, res, (() => {
    passed = true;
  }) as NextFunction);
  return { passed, status };
}

describe("the root's one owner", () => {
  it("is nobody until an account claims it, and that account after", () => {
    expect(rootOwner()).toBeNull();
    expect(claimRoot("a@x.org")).toBe(true);
    expect(rootOwner()).toBe("a@x.org");
    expect(JSON.parse(readFileSync(ownerPath(), "utf8"))).toEqual({
      owner: "a@x.org",
    });
  });

  it("is recorded BESIDE the root, so an absent root still seeds a new account", () => {
    claimRoot("a@x.org");
    expect(ownerPath().startsWith(rootDir())).toBe(false);
    expect(existsSync(rootDir())).toBe(false);
  });

  it("refuses a second account, including one that slugs the same", () => {
    expect(claimRoot("a.b@x.org")).toBe(true);
    expect(claimRoot("a_b@x.org")).toBe(false);
    expect(claimRoot("A.B@x.org")).toBe(false);
    expect(claimRoot("a.b@x.org")).toBe(true);
  });

  it("gates: the owner passes, another account gets a 403, a nameless caller too", () => {
    expect(gate("a@x.org")).toEqual({ passed: true, status: undefined });
    expect(gate("b@x.org")).toEqual({ passed: false, status: 403 });
    expect(gate("")).toEqual({ passed: false, status: 403 });
  });

  it("serves no workspace at all on an engine's machine, whoever asks", () => {
    let status: number | undefined;
    let passed = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
    workspaceGate({ userEmail: "a@x.org" } as Request, res, (() => {
      passed = true;
    }) as NextFunction);
    expect({ passed, status }).toEqual({ passed: false, status: 404 });
    expect(existsSync(ownerPath())).toBe(false);
  });

  it("keeps the engine session the owner's, whoever asks after", () => {
    gate("a@x.org");
    const ws = { root: join(rootDir(), "songs") };
    const before = sessionOf(ws);
    gate("b@x.org");
    expect(sessionOf(ws)).toBe(before);
  });
});
