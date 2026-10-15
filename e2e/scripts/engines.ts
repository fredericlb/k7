// engines.ts — prints the engine list the e2e account sees, to check the machine's engine is listed.
// Usage: node e2e/scripts/engines.ts [baseURL]
import { sessionCookies } from "../src/session.ts";

const base =
  process.argv[2] ?? process.env.E2E_BASE_URL ?? "https://priv.st0.app";
const cookie = sessionCookies(base)
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");
const res = await fetch(new URL("/api/engines", base), { headers: { cookie } });
const engines = (await res.json()) as { id: string; hostname?: string }[];
console.log(
  engines.length === 0
    ? "no engine listed"
    : engines.map((e) => `${e.id} ${e.hostname ?? ""}`).join("\n"),
);
