#!/usr/bin/env node
// tokens.mjs — `npm run tokens`: mint the tokens one studio service uses to call another,
// and put each one where its consumer reads it. Idempotent: a token that still verifies is
// left alone, so this is safe to run on every checkout. See docs/tokens.md.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
/** `--env <file>`, so a test runs the real script against a scratch copy of the secrets. */
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const ENV_FILE = flagValue("env") ?? join(repo, "env.yaml");
const TRAY_SETTINGS = join(homedir(), ".studio", "engine-tray.json");

/** The loopback a checkout takes instead of going out to the LAN proxy and back (../docs/tokens.md). */
const MEDIATEK_DEV_URL = "http://127.0.0.1:8795"; // SERVICE_PORTS.pl8

const LINKS = [
  {
    name: "st0 → pl8",
    issuer: "pl8-backend",
    sub: "service:st0",
    // The file service reads it from the supervisor's settings, and derives its URL (../docs/tokens.md).
    read: () => trayValue("mediatekToken"),
    assign: (token) => setTrayValue("mediatekToken", token),
    where: `${TRAY_SETTINGS} (mediatekToken)`,
  },
  {
    name: "k7 → pl8",
    issuer: "pl8-backend",
    sub: "service:k7",
    read: (doc) => strAt(doc, ["k7-backend", "MEDIATEK_TOKEN"]),
    assign: (token, doc) => setIn(doc, ["k7-backend", "MEDIATEK_TOKEN"], token),
    /** Its half lands in env.yaml, so writing it is what makes the file need saving. */
    envBacked: true,
    devUrl: { at: ["k7-backend", "MEDIATEK_URL"], value: MEDIATEK_DEV_URL },
    where: "env.yaml (k7-backend.MEDIATEK_TOKEN)",
  },
];

// --- the token scheme, byte for byte commons/packages/oidc/apiToken.ts ------------------

// Duplicated rather than imported, and pinned by a test on both halves (../docs/tokens.md).

const b64url = (buf) =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (secret, payload) =>
  b64url(createHmac("sha256", secret).update(payload).digest());

function issue(secret, sub) {
  const payload = b64url(Buffer.from(JSON.stringify({ sub, iat: Date.now() })));
  return `${payload}.${sign(secret, payload)}`;
}

/** Does this token verify against the secret, and for whom? Null when it does not. */
function verify(secret, token) {
  const [payload, sig] = String(token ?? "").split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { sub } = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    );
    return sub ? String(sub) : null;
  } catch {
    return null;
  }
}

// --- env.yaml, edited as a DOCUMENT so the comments survive ------------------------------

function envDoc() {
  if (!existsSync(ENV_FILE)) {
    console.error(`no ${ENV_FILE} — copy env.example.yaml first`);
    process.exit(1);
  }
  return parseDocument(readFileSync(ENV_FILE, "utf8"), { version: "1.2" });
}

/** The secret a service signs its API tokens with, generated on first run (../docs/tokens.md). */
function ensureSecret(doc, service) {
  const current = strAt(doc, [service, "API_TOKEN_SECRET"]);
  if (current) return { secret: current, made: false };
  const secret = randomBytes(32).toString("hex");
  setIn(doc, [service, "API_TOKEN_SECRET"], secret);
  return { secret, made: true };
}

/** A non-empty string at a path in the document, or null. */
function strAt(doc, path) {
  const v = doc.getIn(path);
  return typeof v === "string" && v.trim() ? v : null;
}

/** Set a value, creating the service's section when the file has never had one. */
function setIn(doc, path, value) {
  if (!doc.has(path[0])) doc.set(path[0], {});
  doc.setIn(path, value);
}

// --- the supervisor's settings ------------------------------------------------------------

function trayJson() {
  try {
    return JSON.parse(readFileSync(TRAY_SETTINGS, "utf8"));
  } catch {
    return {}; // absent or unreadable — the supervisor writes defaults on its first change
  }
}

const trayValue = (key) => {
  const v = trayJson()[key];
  return typeof v === "string" && v ? v : null;
};

function setTrayValue(key, value) {
  const settings = { ...trayJson(), [key]: value };
  mkdirSync(dirname(TRAY_SETTINGS), { recursive: true });
  writeFileSync(
    TRAY_SETTINGS,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}

// --- the run -------------------------------------------------------------------------------

const doc = envDoc();
let envTouched = false;
const done = [];

const secrets = new Map(); // one per issuer: two links to the same service share its secret
const fresh = new Set(); // issuers whose secret we just made — every old token is void

for (const link of LINKS) {
  if (!secrets.has(link.issuer)) {
    const made = ensureSecret(doc, link.issuer);
    secrets.set(link.issuer, made.secret);
    envTouched ||= made.made;
    if (made.made) {
      fresh.add(link.issuer);
      done.push(`${link.issuer}: API_TOKEN_SECRET generated`);
    }
  }
  const secret = secrets.get(link.issuer);
  const newSecret = fresh.has(link.issuer);

  // The dev-only loopback, written when the file has none and never overwritten (../docs/tokens.md).
  if (link.devUrl && !strAt(doc, link.devUrl.at)) {
    if (!dryRun) setIn(doc, link.devUrl.at, link.devUrl.value);
    envTouched = true;
    done.push(
      `${link.devUrl.at.join(".")}: ${link.devUrl.value} (checkout only)`,
    );
  }

  // A token that still verifies is left alone: re-minting has a real cost (../docs/tokens.md).
  const held = link.read(doc);
  const holder = newSecret ? null : verify(secret, held);
  if (holder === link.sub && !force) {
    done.push(`${link.name}: already valid`);
    continue;
  }

  const token = issue(secret, link.sub);
  if (!dryRun) link.assign(token, doc);
  envTouched ||= !!link.envBacked;
  done.push(
    `${link.name}: ${held ? "re-minted" : "minted"} → ${link.where}` +
      (newSecret ? " (new secret, so any old one is now void)" : ""),
  );
}

if (envTouched && !dryRun)
  writeFileSync(ENV_FILE, doc.toString({ lineWidth: 0 }), "utf8");

for (const line of done) console.log(`  ${line}`);
if (dryRun) console.log("\n  --dry-run: nothing was written");
else if (envTouched)
  console.log(`\n  ${ENV_FILE} updated — restart the médiathèque backend`);
