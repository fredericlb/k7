// spike-job.mjs — WINDOWS ONLY. Proves the one thing no green test run can: that a
// FORCE-KILLED app takes its children with it. Run it before trusting job.ts.
//
//   node engine/capot/scripts/spike-job.mjs
//
// It builds a throwaway Electron main that inits the real src/job.ts, spawns a long-lived
// grandchild, then taskkill /F's the Electron process WITHOUT /T — so only the job can be
// what kills the grandchild. See docs/tray.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

if (process.platform !== "win32") {
  console.error("skip: the job object is a Windows mechanism");
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "capot-spike-"));
const entry = join(work, "victim.ts");

// The victim: real job.ts, a real spawn, and a pid on stdout for the killer to watch.
writeFileSync(
  entry,
  `import { spawn } from "node:child_process";
import { app } from "electron";
import { assign, init } from ${JSON.stringify(join(root, "src", "job.ts"))};
app.whenReady().then(() => {
  init();
  // node, not \`timeout /t\`: that one refuses to run at all when stdin is redirected, so the
  // grandchild died instantly and the spike could prove nothing. stdio is IGNORED on purpose —
  // a closing pipe must not be what kills it, or the job object gets credit it did not earn.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  assign(child);
  process.stdout.write("CHILD " + child.pid + "\\n");
});
app.on("window-all-closed", () => {});
`,
  "utf8",
);

await esbuild.build({
  entryPoints: [entry],
  outfile: join(work, "victim.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "koffi"],
  define: { __STUDIO_BUILD__: '"spike"' },
  logLevel: "warning",
});

const electron = join(
  root,
  "..",
  "..",
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
if (!existsSync(electron)) {
  console.error(
    "error: no Electron runtime. `npm run app:setup --workspace capot` fetches it —\n" +
      "  electron@44 declares no postinstall, so `npm install` alone never does.",
  );
  process.exit(1);
}

const victim = spawn(electron, [join(work, "victim.cjs")], {
  stdio: ["ignore", "pipe", "inherit"],
});

const childPid = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("victim never reported a child pid")),
    30_000,
  );
  let buf = "";
  victim.stdout.on("data", (d) => {
    buf += d;
    const m = buf.match(/CHILD (\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  });
});

// `kill 0` asks without signalling and needs no output parsing; EPERM means it exists and is
// someone else's, which for this test still counts as alive.
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

console.log(`victim pid ${victim.pid}, grandchild pid ${childPid}`);
// A short retry rather than one immediate look: the pid is valid the moment spawn returns,
// but a check that raced would report the wrong verdict and hide a working job object.
for (let i = 0; i < 20 && !alive(childPid); i++) {
  await new Promise((r) => setTimeout(r, 100));
}
if (!alive(childPid)) {
  console.error(
    "FAIL: the grandchild was never running — the spike proves nothing",
  );
  process.exit(2);
}

// No /T: killing the tree would pass whether or not the job exists, which is the whole point.
spawnSync("taskkill", ["/PID", String(victim.pid), "/F"], {
  windowsHide: true,
});
await new Promise((r) => setTimeout(r, 2000));

// If the kill itself missed, the job never closed and "survived" would blame the wrong thing.
if (alive(victim.pid)) {
  console.error(
    `FAIL: taskkill did not stop the app (pid ${victim.pid}) — nothing was proved.`,
  );
  process.exit(2);
}

const survived = alive(childPid);
rmSync(work, { recursive: true, force: true });

if (survived) {
  spawnSync("taskkill", ["/PID", String(childPid), "/T", "/F"], {
    windowsHide: true,
  });
  console.error(
    "FAIL: the grandchild survived a force-killed app.\n" +
      "  The kill-on-close job is not in effect — a crash will orphan the engine on 8765/8770.\n" +
      "  Check the merged log for a `no kill-on-close job` line.",
  );
  process.exit(1);
}
console.log(
  "PASS: the grandchild died with the force-killed app — the job holds.",
);
