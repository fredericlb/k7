import type { Request, Response } from "express";
import { currentUser } from "../auth/session.ts";
import { gameState } from "../gameState.ts";
import type { GristClient } from "../grist/client.ts";
import { listGristSessions, loadSessionFromGrist } from "../grist/load.ts";
import { asFloat, asInt, asString } from "../grist/values.ts";
import type { Session } from "../session/model.ts";

// Solo endpoints (solo.go): any authenticated user — the global auth
// middleware is the only gate. They never touch the global sessionProgress;
// the multiplayer engine keeps running whatever the operator scheduled.

/** Wire form of a SoloProgress row — the resume shape the SPA replays from. */
interface SoloProgress {
  orderIndex: number;
  songIndex: number;
  score: number;
  played: number;
  total: number;
}

const progressFromFields = (f: Record<string, unknown>): SoloProgress => ({
  orderIndex: asInt(f.orderIndex),
  songIndex: asInt(f.songIndex),
  score: asFloat(f.score),
  played: asInt(f.played),
  total: asInt(f.total),
});

/**
 * The in-progress row for (user, session): [progress, rowId] — [null, 0] when
 * none exists. The row id lets callers patch/delete without re-listing.
 */
async function loadSoloProgress(
  g: GristClient,
  userSubject: string,
  sessionId: number,
): Promise<[SoloProgress | null, number]> {
  if (userSubject === "" || sessionId <= 0) return [null, 0];
  const rows = await g.listRecords("SoloProgress", {
    user: userSubject,
    session: sessionId,
  });
  if (rows.length === 0) return [null, 0];
  return [progressFromFields(rows[0].fields), rows[0].id];
}

/** sessionId → progress for every in-progress row of one user (one roundtrip). */
async function soloProgressForUser(
  g: GristClient,
  userSubject: string,
): Promise<Map<number, SoloProgress>> {
  const out = new Map<number, SoloProgress>();
  if (userSubject === "") return out;
  const rows = await g.listRecords("SoloProgress", { user: userSubject });
  for (const r of rows) {
    const sid = asInt(r.fields.session);
    if (sid > 0) out.set(sid, progressFromFields(r.fields));
  }
  return out;
}

/** sessionId → saved final score for every Scores row of one user. */
async function soloScoresForUser(
  g: GristClient,
  userSubject: string,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (userSubject === "") return out;
  const rows = await g.listRecords("Scores", { user: userSubject });
  for (const r of rows) {
    const sid = asInt(r.fields.session);
    if (sid > 0) out.set(sid, asFloat(r.fields.value));
  }
  return out;
}

const gristOr503 = (res: Response): GristClient | null => {
  if (!gameState.gristClient) {
    res.status(503).json({ error: "grist not configured" });
    return null;
  }
  return gameState.gristClient;
};

const sessionIdParam = (req: Request, res: Response): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return 0;
  }
  return id;
};

// GET /solo/sessions — the catalogue plus the caller's saved score and resume
// marker per session, so the picker renders both without extra requests.
export async function handleSoloListSessions(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  let sessions;
  try {
    sessions = await listGristSessions(g);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  let scores = new Map<number, number>();
  let progress = new Map<number, SoloProgress>();
  const u = currentUser(req);
  if (u?.sub) {
    scores = await soloScoresForUser(g, u.sub).catch(() => new Map());
    progress = await soloProgressForUser(g, u.sub).catch((err) => {
      console.log(`[Solo] list progress (${u.sub}): ${err}`);
      return new Map();
    });
  }
  res.json({
    sessions: sessions.map((s) => {
      const row: Record<string, unknown> = { id: s.id, name: s.name };
      if (scores.has(s.id)) row.score = scores.get(s.id);
      if (progress.has(s.id)) row.resume = progress.get(s.id);
      return row;
    }),
  });
}

// POST /solo/sessions/:id/score — record the final score. First completion
// wins: an existing Scores row is never overwritten; the canonical value is
// returned either way. Completing (either path) deletes the in-progress row.
export async function handleSoloSaveScore(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const u = currentUser(req);
  if (!u?.sub) {
    // Buzzer guests have no subject → excluded from the scoreboard. 403 (not
    // 401) makes the distinction explicit client-side.
    res
      .status(403)
      .json({ error: "score saving requires a non-guest account" });
    return;
  }
  const sessionId = sessionIdParam(req, res);
  if (sessionId === 0) return;
  const score = Number(req.body?.score ?? NaN);
  if (Number.isNaN(score)) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  if (score < 0) {
    res.status(400).json({ error: "score must be non-negative" });
    return;
  }

  let existing;
  try {
    existing = await g.listRecords("Scores", {
      user: u.sub,
      session: sessionId,
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }

  // Either path marks the run complete — clear the in-progress row so the
  // next load returns no resume. Errors are logged-and-swallowed.
  const clearProgress = async () => {
    try {
      const [, rowId] = await loadSoloProgress(g, u.sub!, sessionId);
      if (rowId !== 0) await g.deleteRecords("SoloProgress", [rowId]);
    } catch (err) {
      console.log(
        `[Solo] delete progress (${u.sub}, session=${sessionId}): ${err}`,
      );
    }
  };

  if (existing.length > 0) {
    const canonical = asFloat(existing[0].fields.value);
    // One-shot backfill: legacy rows written before the userName column
    // existed get patched so the leaderboard stops showing "?".
    if (asString(existing[0].fields.userName) === "" && u.name) {
      await g
        .updateRecords(
          "Scores",
          new Map([[existing[0].id, { userName: u.name }]]),
        )
        .catch((err) =>
          console.log(
            `[Solo] backfill userName (${u.sub}, session=${sessionId}): ${err}`,
          ),
        );
    }
    await clearProgress();
    res.json({ score: canonical, persisted: false, sessionId });
    return;
  }

  try {
    await g.addRecords("Scores", [
      { user: u.sub, session: sessionId, value: score, userName: u.name ?? "" },
    ]);
  } catch (err) {
    await clearProgress();
    res.status(502).json({ error: String(err) });
    return;
  }
  await clearProgress();
  res.json({ score, persisted: true, sessionId });
}

// GET /solo/sessions/:id/leaderboard — every recorded final score, highest
// first, standard competition ranking (ties share a rank, the next skips).
// Empty userName values fall back to the Guests table, then "?".
export async function handleSoloLeaderboard(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const sessionId = sessionIdParam(req, res);
  if (sessionId === 0) return;
  let rows;
  try {
    rows = await g.listRecords("Scores", { session: sessionId });
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }

  const me = currentUser(req)?.sub ?? "";

  // Resolve empty names via one Guests pre-fetch instead of N lookups.
  const emptyNameSubjects = new Set<string>();
  for (const row of rows) {
    if (asString(row.fields.userName) === "") {
      const subject = asString(row.fields.user);
      if (subject !== "") emptyNameSubjects.add(subject);
    }
  }
  const guestNames = new Map<string, string>();
  if (emptyNameSubjects.size > 0) {
    try {
      for (const gRow of await g.listRecords("Guests")) {
        const subj = asString(gRow.fields.subject);
        if (emptyNameSubjects.has(subj))
          guestNames.set(subj, asString(gRow.fields.username));
      }
    } catch (err) {
      console.log(`[Solo] leaderboard guests lookup: ${err}`);
    }
  }

  const entries = rows.map((row) => {
    const subject = asString(row.fields.user);
    let name = asString(row.fields.userName);
    if (name === "") name = guestNames.get(subject) || "?";
    return { subject, name, value: asFloat(row.fields.value) };
  });
  entries.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    // Deterministic tie order across reloads: name, then subject.
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });

  let prevScore = -1;
  let rank = 0;
  const out = entries.map((e, i) => {
    // Standard competition ranking: 100, 100, 90 → 1, 1, 3.
    if (i === 0 || e.value !== prevScore) rank = i + 1;
    prevScore = e.value;
    const entry: Record<string, unknown> = {
      rank,
      userName: e.name,
      score: e.value,
    };
    if (me !== "" && e.subject === me) entry.isMe = true;
    return entry;
  });
  res.json({ sessionId, entries: out });
}

// GET /solo/sessions/:id — the full Session JSON for client-side playback.
// Blocks until the attachment cache is warm; paths come back /audio/-prefixed.
// Includes the caller's in-progress run as `resume` when one exists.
export async function handleSoloLoadSession(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const id = sessionIdParam(req, res);
  if (id === 0) return;
  let session;
  try {
    session = await loadSessionFromGrist(g, id);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  prefixSessionAudioPaths(session);

  const resp: Record<string, unknown> = { id, session };
  const u = currentUser(req);
  if (u?.sub) {
    try {
      const [p] = await loadSoloProgress(g, u.sub, id);
      if (p) resp.resume = p;
    } catch (err) {
      console.log(`[Solo] load progress (${u.sub}, session=${id}): ${err}`);
    }
  }
  res.json(resp);
}

// POST /solo/sessions/:id/progress — upsert the caller's in-progress state.
// Fire-and-forget on the frontend.
export async function handleSoloSaveProgress(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const u = currentUser(req);
  if (!u?.sub) {
    res
      .status(403)
      .json({ error: "progress saving requires a non-guest account" });
    return;
  }
  const sessionId = sessionIdParam(req, res);
  if (sessionId === 0) return;
  const body = req.body as Partial<SoloProgress> | undefined;
  const orderIndex = Number(body?.orderIndex ?? 0);
  const songIndex = Number(body?.songIndex ?? 0);
  const played = Number(body?.played ?? 0);
  const total = Number(body?.total ?? 0);
  const score = Number(body?.score ?? 0);
  if ([orderIndex, songIndex, played, total, score].some(Number.isNaN)) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  if (score < 0 || orderIndex < 0) {
    res.status(400).json({ error: "negative orderIndex/score" });
    return;
  }

  let rowId: number;
  try {
    [, rowId] = await loadSoloProgress(g, u.sub, sessionId);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  const fields = {
    user: u.sub,
    session: sessionId,
    orderIndex,
    songIndex,
    played,
    total,
    score,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  try {
    if (rowId === 0) await g.addRecords("SoloProgress", [fields]);
    else await g.updateRecords("SoloProgress", new Map([[rowId, fields]]));
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  console.log(
    `[Solo] saveProgress user="${u.sub}" session=${sessionId} orderIndex=${orderIndex} songIndex=${songIndex} played=${played} total=${total} score=${score}`,
  );
  res.json({ ok: true });
}

/**
 * Rewrite bare relative audio paths into /audio/-prefixed URLs across a whole
 * Session, in place — the solo twin of the multiplayer handlers' prefixing.
 */
export function prefixSessionAudioPaths(s: Session): void {
  const pfx = (p: string | undefined): string | undefined => {
    if (p && !p.startsWith("/") && !p.startsWith("http")) return `/audio/${p}`;
    return p;
  };
  for (const cat of s.categories) {
    for (const song of cat.songs) {
      song.path = pfx(song.path);
      song.fullSong = pfx(song.fullSong);
      for (const t of song.tracks ?? []) {
        t.path = pfx(t.path);
        t.fullSong = pfx(t.fullSong);
      }
    }
  }
}
