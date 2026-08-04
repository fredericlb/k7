import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { gameState } from "../gameState.ts";
import type { GristRecord } from "../grist/client.ts";
import { asString } from "../grist/values.ts";
import { setSessionUser } from "./session.ts";

// Online-guest entry flow (online_guest.go), used by the SPA's /t/<token>
// route. The browser keeps a UUID ("guest subject") in localStorage; the
// Guests Grist table maps subject → username (globally unique, application-
// enforced). A successful claim sets the normal session cookie with
// kind="guest_online" and sub=<UUID>, so everywhere that gates on a subject
// treats the guest like a real user (solo score/progress accept it).

const gristOr503 = (res: Response) => {
  if (!gameState.gristClient) {
    res.status(503).json({ error: "grist not configured" });
    return null;
  }
  return gameState.gristClient;
};

// GET /sessions/by-token/:token — public alias → (id, name) resolver so the
// gate can show "you're about to play <name>" to unauthenticated visitors.
export async function handleResolveSessionToken(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const token = String(req.params.token ?? "").trim();
  if (token === "") {
    res.status(400).json({ error: "missing token" });
    return;
  }
  let rows;
  try {
    rows = await g.listRecords("Sessions", { urlToken: token });
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  if (rows.length === 0) {
    res.status(404).json({ error: "unknown token" });
    return;
  }
  res.json({ id: rows[0].id, name: asString(rows[0].fields.name) });
}

// GET /auth/guest-lookup?id=<uuid> — pre-fill the gate with the username last
// associated with this browser's stored guest UUID. Quiet 404 = first-timer.
export async function handleGuestLookup(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const id = String(req.query.id ?? "").trim();
  if (id === "") {
    res.status(400).json({ error: "missing id" });
    return;
  }
  let row: GristRecord | null;
  try {
    row = await findGuestBySubject(id);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "unknown guest" });
    return;
  }
  res.json({
    subject: asString(row.fields.subject),
    username: asString(row.fields.username),
  });
}

// POST /auth/guest-online — claim (or re-claim) a guest identity.
// Returning guest: matching guestId row; a changed username must still be
// globally unique (rename). Fresh guest: mint/keep a UUID, insert the row.
// 409 on collision; 200 with {guestId, username}.
export async function handleAuthGuestOnline(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const username = String(req.body?.username ?? "").trim();
  if (!isValidGuestUsername(username)) {
    res.status(400).json({ error: "invalid username" });
    return;
  }
  const guestId = String(req.body?.guestId ?? "").trim();

  let existing: GristRecord | null = null;
  if (guestId !== "") {
    try {
      existing = await findGuestBySubject(guestId);
    } catch (err) {
      res.status(502).json({ error: String(err) });
      return;
    }
  }

  try {
    if (existing) {
      // Returning guest: rename only when the (case-folded) name changed.
      const current = asString(existing.fields.username);
      if (current.toLowerCase() !== username.toLowerCase()) {
        if (await isUsernameTaken(username, existing.id)) {
          res.status(409).json({ error: "username taken" });
          return;
        }
        await g.updateRecords("Guests", new Map([[existing.id, { username }]]));
      }
      setGuestOnlineSession(res, guestId, username);
      res.json({ guestId, username });
      return;
    }

    // Fresh guest (no stored id, or its row was wiped server-side).
    if (await isUsernameTaken(username, 0)) {
      res.status(409).json({ error: "username taken" });
      return;
    }
    // Keep a well-formed caller-provided id so a guest whose row was deleted
    // still lines up with their old Scores rows.
    const newId = looksLikeGuestId(guestId) ? guestId : mintGuestId();
    await g.addRecords("Guests", [
      { subject: newId, username, createdAt: Math.floor(Date.now() / 1000) },
    ]);
    setGuestOnlineSession(res, newId, username);
    console.log(
      `[GuestOnline] registered subject=${newId} username="${username}"`,
    );
    res.json({ guestId: newId, username });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function findGuestBySubject(
  subject: string,
): Promise<GristRecord | null> {
  if (subject === "") return null;
  const rows = await gameState.gristClient!.listRecords("Guests", { subject });
  return rows[0] ?? null;
}

// Case-insensitive uniqueness over the whole (small) Guests table — Grist has
// no case-insensitive Text equality, so fold here.
async function isUsernameTaken(
  username: string,
  exceptRowId: number,
): Promise<boolean> {
  if (username === "") return false;
  const rows = await gameState.gristClient!.listRecords("Guests");
  return rows.some(
    (r) =>
      r.id !== exceptRowId &&
      asString(r.fields.username).toLowerCase() === username.toLowerCase(),
  );
}

/** Trimmed length 1..32, no control characters. */
export function isValidGuestUsername(s: string): boolean {
  if (s.length < 1 || s.length > 32) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f-\u009f]/.test(s);
}

/** Cheap shape check: 16–64 hex chars (dashes allowed), nothing else. */
export function looksLikeGuestId(s: string): boolean {
  return s.length >= 16 && s.length <= 64 && /^[0-9a-fA-F-]+$/.test(s);
}

/** 32-char hex id — UUID-grade entropy, trivially JSON/localStorage-safe. */
export function mintGuestId(): string {
  return randomBytes(16).toString("hex");
}

function setGuestOnlineSession(
  res: Response,
  guestId: string,
  username: string,
): void {
  setSessionUser(res.req, {
    kind: "guest_online",
    sub: guestId,
    name: username,
  });
}
