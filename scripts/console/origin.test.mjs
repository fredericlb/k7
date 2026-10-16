// origin.test.mjs — the console's Origin allowlist; run with `node --test scripts/console/`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOrigins, originAllowed } from "./origin.mjs";

const allowed = allowedOrigins(8797, " https://Other.example/ ,");

test("the console's own origin and loopback on its port pass", () => {
  assert.equal(
    originAllowed("https://console.priv.frediver.se", allowed),
    true,
  );
  assert.equal(originAllowed("http://localhost:8797", allowed), true);
  assert.equal(originAllowed("http://127.0.0.1:8797", allowed), true);
  assert.equal(originAllowed("http://[::1]:8797", allowed), true);
});

test("the override adds origins, normalised", () => {
  assert.equal(originAllowed("https://other.example", allowed), true);
});

test("anything else is refused", () => {
  for (const o of [
    undefined,
    "",
    "null",
    "https://evil.example",
    "http://console.priv.frediver.se",
    "https://console.priv.frediver.se.evil.example",
    "http://localhost:5173",
    "http://127.0.0.1:8798",
  ])
    assert.equal(originAllowed(o, allowed), false, String(o));
});
