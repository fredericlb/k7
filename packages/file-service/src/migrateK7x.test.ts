// migrateK7x.test.ts — `POST /migrate-k7x`: a dry run reports, a real one is refused until the operator turns it on,
// and then converts the workspace, the originals kept in its hidden backup folder.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MigrateReport } from "@studio/song/k7xMigrate";
import express from "express";
import { afterEach, beforeEach, expect, it } from "vitest";
import { filesRouter } from "./routes/files.ts";
import { Workspace } from "./workspace.ts";

let root: string;
let server: ReturnType<express.Express["listen"]>;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "fs-k7x-"));
  mkdirSync(join(root, "song.st0", "nodes"), { recursive: true });
  writeFileSync(
    join(root, "song.st0", "project.yaml"),
    "project:\n  name: song\n",
  );
  writeFileSync(
    join(root, "song.st0", "nodes", "gtr.yaml"),
    "x: &a 1\ny: *a\n",
  );
  const ws = new Workspace(root);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { ws: unknown }).ws = ws;
    next();
  });
  app.use(filesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env.STUDIO_K7X;
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

const migrate = (dryRun: boolean) =>
  fetch(`${base}/migrate-k7x`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun }),
  }).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as MigrateReport,
  }));

it("reports what it would do on a dry run, and touches nothing", async () => {
  const r = await migrate(true);
  expect(r.status).toBe(200);
  expect(r.body.converted).toEqual(["song.st0/project.yaml"]);
  expect(r.body.refused).toEqual([
    {
      file: "song.st0/nodes/gtr.yaml",
      reason: "k7x: YAML anchors have no k7x form",
    },
  ]);
  expect(existsSync(join(root, "song.st0", "project.k7x"))).toBe(false);
});

it("refuses a real run until the operator turns it on", async () => {
  const r = await migrate(false);
  expect(r.status).toBe(409);
  expect(existsSync(join(root, "song.st0", "project.yaml"))).toBe(true);
});

it("converts once on, keeping each original in the hidden backup", async () => {
  process.env.STUDIO_K7X = "1";
  const r = await migrate(false);
  expect(r.status).toBe(200);
  expect(r.body.converted).toEqual(["song.st0/project.yaml"]);
  expect(existsSync(join(root, "song.st0", "project.k7x"))).toBe(true);
  expect(existsSync(join(root, "song.st0", "project.yaml"))).toBe(false);
  const [stamp] = readdirSync(join(root, ".k7x-backup"));
  expect(
    existsSync(join(root, ".k7x-backup", stamp, "song.st0", "project.yaml")),
  ).toBe(true);
  expect(existsSync(join(root, "song.st0", "nodes", "gtr.yaml"))).toBe(true);
});
