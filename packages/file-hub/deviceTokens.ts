// deviceTokens.ts — the credential a machine dials the sync relay with: one per device an account added.
// A token is signed, so it proves its account without a lookup; the account's device list is checked too,
// which is what makes removing a device cut it off. See docs/syncRelay.md.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Device {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
}

const b64 = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64url");

export class DeviceTokens {
  constructor(
    private readonly key: Buffer,
    /** The account folder its device list is kept under: `<dataRoot>/<slug>`. */
    private readonly accountDir: (slug: string) => string,
  ) {}

  private file(slug: string): string {
    return join(this.accountDir(slug), ".sync-relay", "devices.json");
  }

  private sign(payload: string): string {
    return b64(createHmac("sha256", this.key).update(payload).digest());
  }

  list(slug: string): Device[] {
    const f = this.file(slug);
    return existsSync(f)
      ? (JSON.parse(readFileSync(f, "utf8")) as Device[])
      : [];
  }

  private save(slug: string, devices: Device[]): void {
    const f = this.file(slug);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, JSON.stringify(devices, null, 2));
  }

  /** A new device for the account, and the token it will dial with; the token is shown once. */
  mint(slug: string, name: string): { device: Device; token: string } {
    const device: Device = { id: randomUUID(), name, created: Date.now() };
    this.save(slug, [...this.list(slug), device]);
    const payload = b64(JSON.stringify({ s: slug, d: device.id }));
    return { device, token: `${payload}.${this.sign(payload)}` };
  }

  revoke(slug: string, id: string): boolean {
    const devices = this.list(slug);
    const kept = devices.filter((d) => d.id !== id);
    if (kept.length === devices.length) return false;
    this.save(slug, kept);
    return true;
  }

  /** The account and device a token names, when it is signed here and the device is still listed. */
  verify(token: string): { slug: string; id: string } | null {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const want = Buffer.from(this.sign(payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    let claim: { s?: unknown; d?: unknown };
    try {
      claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof claim.s !== "string" || typeof claim.d !== "string") return null;
    const devices = this.list(claim.s);
    const device = devices.find((d) => d.id === claim.d);
    if (!device) return null;
    device.lastSeen = Date.now();
    this.save(claim.s, devices);
    return { slug: claim.s, id: claim.d };
  }
}
