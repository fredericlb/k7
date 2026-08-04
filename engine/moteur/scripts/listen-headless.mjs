// listen-headless.mjs — the browser half, actually playing, with nobody in the room.
// Bundles StreamPlayer + the AudioWorklet sink, serves them, drives headless Chrome over
// CDP, and reads back what the audio thread did. Closes the one gap the Node measurer
// cannot: that the worklet path really consumes a stream. See docs/broadcast.md.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import WebSocket from "ws";

const engineUrl = process.argv[2] ?? "ws://127.0.0.1:8799";
const seconds = Number(process.argv[3] ?? 20);
const CHROME =
  process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function fail(msg) {
  console.error(`FAILED: ${msg}`);
  return 2;
}

const tmp = mkdtempSync(join(tmpdir(), "studio-listen-"));
const cleanup = [];
const done = (code) => {
  for (const fn of cleanup.reverse()) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(code);
};

// --- 1. Bundle the real modules, not a reimplementation -----------------------
// The whole point is to exercise packages/engine-browser as shipped; a hand-written copy
// in the page would prove only that the copy works.
// Fed through stdin with resolveDir set to the repo, NOT written to the temp dir: esbuild
// resolves bare specifiers relative to the importing FILE, so an entry sitting in %TEMP%
// cannot see node_modules and `@studio/*` comes back unresolved.
const ENTRY = `
import { StreamPlayer } from "@studio/engine-browser/stream";
import { createWorkletSink } from "@studio/engine-browser/stream-sink";

window.__run = async (url, ms) => {
  const first = await new Promise((res, rej) => {
    const probe = new WebSocket(url);
    probe.binaryType = "arraybuffer";
    probe.onopen = () => {
      probe.send(JSON.stringify({ type: "broadcast", on: true }));
    };
    probe.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        probe.close();
        res(new DataView(e.data).getUint32(8, true)); // sampleRate, from the header
      }
    };
    probe.onerror = () => rej(new Error("probe socket failed"));
    setTimeout(() => rej(new Error("no frame within 8s")), 8000);
  });

  // The context MUST be built at the stream's rate: the sink does not resample, and 44.1
  // material in a 48 kHz context is a pitch shift rather than an audible fault.
  const ctx = new AudioContext({ sampleRate: first, latencyHint: "interactive" });
  await ctx.resume();
  const sink = await createWorkletSink(ctx, { channels: 2 });
  sink.node.connect(ctx.destination);
  const player = new StreamPlayer(sink);

  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(JSON.stringify({ type: "broadcast", on: true }));
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) player.handle(e.data);
  };

  const depths = [];
  const tick = setInterval(() => depths.push(sink.stats().depth), 250);
  await new Promise((r) => setTimeout(r, ms));
  clearInterval(tick);
  ws.close();

  const s = player.snapshot();
  const st = sink.stats();
  return {
    contextRate: ctx.sampleRate,
    contextState: ctx.state,
    frames: s.frames,
    framesOfAudio: s.framesOfAudio,
    dropped: s.dropped,
    rejected: s.rejected,
    formatChanges: s.formatChanges,
    format: s.format,
    jitterSpread: s.jitterMs.max - s.jitterMs.min,
    driftMsPerMin: s.driftMsPerMin,
    underruns: st.underruns,
    overruns: st.overruns,
    depthFirst: depths[0] ?? null,
    depthLast: depths[depths.length - 1] ?? null,
    depthMin: depths.length ? Math.min(...depths) : null,
    depthMax: depths.length ? Math.max(...depths) : null,
    samples: depths.length,
  };
};
window.__ready = true;
`;

await build({
  stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: "js" },
  bundle: true,
  format: "iife",
  outfile: join(tmp, "bundle.js"),
  logLevel: "warning",
});

writeFileSync(
  join(tmp, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>listen</title><script src="/bundle.js"></script>`,
);

// --- 2. Serve it -------------------------------------------------------------
const server = createServer((req, res) => {
  const which = req.url === "/bundle.js" ? "bundle.js" : "index.html";
  const type = which.endsWith(".js") ? "text/javascript" : "text/html";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(join(tmp, which)));
});
const port = await new Promise((res) => {
  server.listen(0, "127.0.0.1", () => res(server.address().port));
});
cleanup.push(() => server.close());

// --- 3. Drive Chrome ---------------------------------------------------------
// --autoplay-policy: an AudioContext stays suspended without a user gesture, and there is
// nobody here to click. --headless=new keeps Web Audio real (it renders to a null sink at
// the nominal rate) rather than stubbing it out.
// A FIXED debugging port, discovered over HTTP rather than by reading stderr. On Windows
// the process spawned here is only a launcher: it forks the real browser and exits 0
// immediately, taking its stderr — and the "DevTools listening on…" line — with it. Waiting
// on that line reads as "chrome exited with 0" while a perfectly healthy browser runs.
const dbgPort = 9222 + (process.pid % 500);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${dbgPort}`,
    `--user-data-dir=${join(tmp, "profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu",
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: "ignore", detached: false },
);

let wsEndpoint = null;
for (let i = 0; i < 100 && !wsEndpoint; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const v = await fetch(`http://127.0.0.1:${dbgPort}/json/version`);
    wsEndpoint = (await v.json()).webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
if (!wsEndpoint) done(fail("chrome never opened its devtools port"));
// The launcher is already gone; the browser is closed through CDP instead.
cleanup.push(() => {
  try {
    chrome.kill();
  } catch {
    /* already gone */
  }
});

const browser = new WebSocket(wsEndpoint, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => browser.once("open", r));
let msgId = 0;
const pending = new Map();
browser.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { targetInfos } = await send("Target.getTargets");
const page = targetInfos.find((t) => t.type === "page");
if (!page) done(fail("no page target"));
const { sessionId } = await send("Target.attachToTarget", {
  targetId: page.targetId,
  flatten: true,
});
await send("Runtime.enable", {}, sessionId);

// The bundle may still be loading when we attach.
for (let i = 0; i < 100; i++) {
  const r = await send(
    "Runtime.evaluate",
    { expression: "!!window.__ready", returnByValue: true },
    sessionId,
  );
  if (r.result?.value) break;
  await new Promise((r2) => setTimeout(r2, 100));
}

console.log(`playing ${engineUrl} in headless Chrome for ${seconds}s…`);
const out = await send(
  "Runtime.evaluate",
  {
    expression: `window.__run(${JSON.stringify(engineUrl)}, ${seconds * 1000})`,
    awaitPromise: true,
    returnByValue: true,
    timeout: (seconds + 30) * 1000,
  },
  sessionId,
);

if (out.exceptionDetails) {
  done(
    fail(
      out.exceptionDetails.exception?.description ??
        out.exceptionDetails.text ??
        "unknown",
    ),
  );
}

const r = out.result.value;
const line = (k, v) => console.log(`  ${k.padEnd(24)} ${v}`);
console.log("\n=== a real browser, actually playing ===");
line("AudioContext", `${r.contextRate} Hz, ${r.contextState}`);
line("stream format", r.format ? `${r.format.sampleRate} Hz, ${r.format.channels} ch` : "none");
line("frames decoded", r.frames);
line("audio consumed", `${(r.framesOfAudio / (r.format?.sampleRate || 1)).toFixed(2)}s`);
line("dropped by sender", r.dropped);
line("undecodable", r.rejected);
line("format changes", r.formatChanges);
line("jitter spread", `${r.jitterSpread.toFixed(2)} ms`);
line("drift", r.driftMsPerMin === null ? "not enough stream yet" : `${r.driftMsPerMin.toFixed(2)} ms/min`);
line("worklet underruns", r.underruns);
line("worklet overruns", r.overruns);
line(
  "buffer depth (frames)",
  `first ${r.depthFirst}, last ${r.depthLast}, min ${r.depthMin}, max ${r.depthMax}`,
);
// The depth trend IS the drift, seen from the consumer: a cushion that walks steadily one
// way is two clocks disagreeing, and it is what a fixed cushion eventually loses to.
if (r.depthFirst !== null && r.depthLast !== null && r.format)
  line(
    "depth drift",
    `${(((r.depthLast - r.depthFirst) / r.format.sampleRate) * 1000).toFixed(1)} ms over the run`,
  );
if (r.frames === 0) done(fail("the browser received nothing"));
done(0);
