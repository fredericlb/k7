import type { Request, Response } from "express";
import { gameState } from "../gameState.ts";
import {
  type GristClient,
  type GristFields,
  type GristRecord,
  gristIdList,
} from "../grist/client.ts";
import { cacheRawAttachment } from "../grist/load.ts";
import {
  asBool,
  asFloat,
  asInt,
  asString,
  optInt,
  parseRefList,
} from "../grist/values.ts";

// The retired Grist editor's API: every row id round-trips, so a save can tell new from existing.

interface EditorOrderEntry {
  id: number;
  type: string; // "cat" or "pause"
  categoryId?: number;
  start?: number;
  end?: number;
}

interface EditorCategory {
  id: number;
  name: string;
  mode?: string;
  notice?: string;
  illustration?: string;
  trackType?: string;
  liveOnly?: boolean;
  songIds: number[];
}

interface EditorSong {
  id: number;
  label?: string;
  status?: string;
  answer?: string;
  liveOnly?: boolean;
  effects?: Record<string, number>;
  trackIds: number[];
  firstArtist?: string;
  firstTitle?: string;
}

interface EditorTrack {
  id: number;
  artist?: string;
  title?: string;
  type?: string;
  start?: number;
  end?: number;
  youtubeId?: string;
  audioRowId?: number;
  hasAudio: boolean;
}

const gristOr503 = (res: Response): GristClient | null => {
  if (!gameState.gristClient) {
    res.status(503).json({ error: "grist not configured" });
    return null;
  }
  return gameState.gristClient;
};

const idParam = (req: Request, res: Response): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return 0;
  }
  return id;
};

/** Pull every row of a table into a Map by id (grist_tree.go indexRows). */
async function indexRows(
  g: GristClient,
  table: string,
): Promise<Map<number, GristRecord>> {
  const out = new Map<number, GristRecord>();
  for (const r of await g.listRecords(table)) out.set(r.id, r);
  return out;
}

// ─── Row → editor* converters ───────────────────────────────────────────────

function categoryFromRow(id: number, r: GristRecord): EditorCategory {
  return {
    id,
    name: asString(r.fields.name),
    mode: asString(r.fields.mode),
    notice: asString(r.fields.notice),
    illustration: asString(r.fields.illustration),
    trackType: asString(r.fields.trackType),
    liveOnly: asBool(r.fields.liveOnly),
    songIds: parseRefList(r.fields.songs),
  };
}

function songFromRow(
  id: number,
  r: GristRecord,
  trackById: Map<number, GristRecord> | null,
): EditorSong {
  const effects: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.fields)) {
    if (!k.startsWith("fx_")) continue;
    const val = asInt(v);
    if (val !== 0) effects[k.slice(3)] = val;
  }
  const s: EditorSong = {
    id,
    label: asString(r.fields.label),
    status: asString(r.fields.status),
    answer: asString(r.fields.answer),
    liveOnly: asBool(r.fields.liveOnly),
    effects: Object.keys(effects).length > 0 ? effects : undefined,
    trackIds: parseRefList(r.fields.tracks),
  };
  // First-track preview for the picker's "{answer} - {artist} - {title}" label.
  if (s.trackIds.length > 0 && trackById) {
    const trow = trackById.get(s.trackIds[0]);
    if (trow) {
      s.firstArtist = asString(trow.fields.artist);
      s.firstTitle = asString(trow.fields.title);
    }
  }
  return s;
}

function trackFromRow(id: number, r: GristRecord): EditorTrack {
  const audioIds = parseRefList(r.fields.audio);
  return {
    id,
    artist: asString(r.fields.artist),
    title: asString(r.fields.title),
    type: asString(r.fields.type),
    start: asFloat(r.fields.start),
    end: asFloat(r.fields.end),
    youtubeId: asString(r.fields.youtubeId),
    audioRowId: audioIds[0],
    hasAudio: audioIds.length > 0,
  };
}

// ─── Read endpoints ─────────────────────────────────────────────────────────

// GET /editor/sessions — id/name of every session (the editor's own picker).
export async function handleEditorListSessions(
  _req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  let rows;
  try {
    rows = await g.listRecords("Sessions");
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  rows.sort((a, b) => a.id - b.id);
  res.json({
    sessions: rows.map((r) => ({ id: r.id, name: asString(r.fields.name) })),
  });
}

// GET /editor/sessions/:id — the id-preserving form, embedding everything its order reaches.
export async function handleEditorLoadSession(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const id = idParam(req, res);
  if (id === 0) return;

  let sessionById, orderById, catById, songById, trackById;
  try {
    [sessionById, orderById, catById, songById, trackById] = await Promise.all([
      indexRows(g, "Sessions"),
      indexRows(g, "OrderEntries"),
      indexRows(g, "Categories"),
      indexRows(g, "Songs"),
      indexRows(g, "Tracks"),
    ]);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  const srow = sessionById.get(id);
  if (!srow) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const out = {
    id,
    name: asString(srow.fields.name),
    guestPassword: asString(srow.fields.guestPassword),
    order: [] as EditorOrderEntry[],
    categories: [] as EditorCategory[],
    songs: [] as EditorSong[],
    tracks: [] as EditorTrack[],
  };
  const catSeen = new Set<number>();
  const songSeen = new Set<number>();
  const trackSeen = new Set<number>();
  for (const oid of parseRefList(srow.fields.order)) {
    const orow = orderById.get(oid);
    if (!orow) continue;
    const entry: EditorOrderEntry = {
      id: oid,
      type: asString(orow.fields.type),
    };
    const start = optInt(orow.fields.start);
    if (start !== null) entry.start = start;
    const end = optInt(orow.fields.end);
    if (end !== null) entry.end = end;
    if (entry.type !== "pause") {
      entry.categoryId = asInt(orow.fields.category);
      if (entry.categoryId > 0 && !catSeen.has(entry.categoryId)) {
        catSeen.add(entry.categoryId);
        const crow = catById.get(entry.categoryId);
        if (crow) {
          const cat = categoryFromRow(entry.categoryId, crow);
          out.categories.push(cat);
          for (const sid of cat.songIds) {
            if (songSeen.has(sid)) continue;
            songSeen.add(sid);
            const sgRow = songById.get(sid);
            if (!sgRow) continue;
            const sg = songFromRow(sid, sgRow, trackById);
            out.songs.push(sg);
            for (const tid of sg.trackIds) {
              if (trackSeen.has(tid)) continue;
              trackSeen.add(tid);
              const trow = trackById.get(tid);
              if (trow) out.tracks.push(trackFromRow(tid, trow));
            }
          }
        }
      }
    }
    out.order.push(entry);
  }
  res.json(out);
}

// GET /editor/library/:kind — every Categories | Songs | Tracks row, by id, for the pickers.
export async function handleEditorListLibrary(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const kind = String(req.params.kind ?? "");
  try {
    if (kind === "categories") {
      const rows = (await g.listRecords("Categories")).sort(
        (a, b) => a.id - b.id,
      );
      res.json({ categories: rows.map((r) => categoryFromRow(r.id, r)) });
    } else if (kind === "songs") {
      const [rows, trackById] = await Promise.all([
        g.listRecords("Songs"),
        indexRows(g, "Tracks"),
      ]);
      rows.sort((a, b) => a.id - b.id);
      res.json({ songs: rows.map((r) => songFromRow(r.id, r, trackById)) });
    } else if (kind === "tracks") {
      const rows = (await g.listRecords("Tracks")).sort((a, b) => a.id - b.id);
      res.json({ tracks: rows.map((r) => trackFromRow(r.id, r)) });
    } else {
      res.status(400).json({
        error: `unknown library kind "${kind}" (expected categories|songs|tracks)`,
      });
    }
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}

// POST /editor/attachments — multer parses the multipart body, Grist returns the row id.
export async function handleEditorUploadAttachment(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const file = (
    req as Request & { file?: { originalname: string; buffer: Buffer } }
  ).file;
  if (!file) {
    res.status(400).json({ error: "missing file field" });
    return;
  }
  let id: number;
  try {
    id = await g.uploadAttachment(file.originalname, file.buffer);
  } catch (err) {
    res.status(502).json({ error: `upload: ${err}` });
    return;
  }
  res.json({ id, filename: file.originalname, size: file.buffer.length });
}

// GET /editor/attachments/:id/url — through the RAW cache: a preview wants the untrimmed original.
export async function handleEditorAttachmentURL(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const attId = idParam(req, res);
  if (attId === 0) return;
  try {
    const fileIdents = await g.attachmentFileIdents([attId]);
    const relPath = await cacheRawAttachment(
      g,
      attId,
      fileIdents.get(attId) ?? "",
    );
    // Cache paths are OS-joined; URLs always use forward slashes.
    res.json({ url: "/audio/" + relPath.replaceAll("\\", "/") });
  } catch (err) {
    res.status(502).json({ error: `ensure attachment: ${err}` });
  }
}

// ─── Create / duplicate ─────────────────────────────────────────────────────

// POST /editor/sessions — spawn an empty Session row. Body: {"name": …}.
export async function handleEditorCreateSession(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const name = String(req.body?.name ?? "").trim();
  if (name === "") {
    res.status(400).json({ error: "name required" });
    return;
  }
  try {
    const [id] = await g.addRecords("Sessions", [{ name }]);
    res.json({ id, name });
  } catch (err) {
    res.status(502).json({ error: `create session: ${err}` });
  }
}

// POST /editor/sessions/:id/duplicate — Session, OrderEntries and Categories; the library is shared.
export async function handleEditorDuplicateSession(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const sessionId = idParam(req, res);
  if (sessionId === 0) return;
  const name = String(req.body?.name ?? "").trim();
  if (name === "") {
    res.status(400).json({ error: "name required" });
    return;
  }

  try {
    const [sessionById, orderById, catById] = await Promise.all([
      indexRows(g, "Sessions"),
      indexRows(g, "OrderEntries"),
      indexRows(g, "Categories"),
    ]);
    const srow = sessionById.get(sessionId);
    if (!srow) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const orderIds = parseRefList(srow.fields.order);

    // Step 1: each referenced category, its songs RefList copied verbatim rather than cloned.
    const catIdMap = new Map<number, number>();
    const catCreates: GristFields[] = [];
    const catCreateOrigIds: number[] = [];
    for (const oid of orderIds) {
      const orow = orderById.get(oid);
      if (!orow || asString(orow.fields.type) === "pause") continue;
      const cid = asInt(orow.fields.category);
      if (cid <= 0 || catIdMap.has(cid)) continue;
      const crow = catById.get(cid);
      if (!crow) continue;
      catCreates.push({
        name: asString(crow.fields.name),
        mode: asString(crow.fields.mode),
        notice: asString(crow.fields.notice),
        illustration: asString(crow.fields.illustration),
        trackType: asString(crow.fields.trackType),
        liveOnly: asBool(crow.fields.liveOnly),
        songs: crow.fields.songs,
      });
      catCreateOrigIds.push(cid);
      catIdMap.set(cid, -1); // reserve for dedup
    }
    if (catCreates.length > 0) {
      const newIds = await g.addRecords("Categories", catCreates);
      newIds.forEach((nid, i) => catIdMap.set(catCreateOrigIds[i], nid));
    }

    // Step 2: duplicate each order entry, retargeting categories.
    const orderCreates: GristFields[] = [];
    for (const oid of orderIds) {
      const orow = orderById.get(oid);
      if (!orow) continue;
      const fields: GristFields = { type: asString(orow.fields.type) };
      if (fields.type !== "pause") {
        const newCat = catIdMap.get(asInt(orow.fields.category));
        if (newCat && newCat > 0) fields.category = newCat;
      }
      const start = optInt(orow.fields.start);
      if (start !== null) fields.start = start;
      const end = optInt(orow.fields.end);
      if (end !== null) fields.end = end;
      orderCreates.push(fields);
    }
    const newOrderIds =
      orderCreates.length > 0
        ? await g.addRecords("OrderEntries", orderCreates)
        : [];

    // Step 3: the new Session.
    const sessionFields: GristFields = {
      name,
      guestPassword: asString(srow.fields.guestPassword),
    };
    if (newOrderIds.length > 0)
      sessionFields.order = gristIdList(...newOrderIds);
    const [newSessionId] = await g.addRecords("Sessions", [sessionFields]);

    res.json({
      id: newSessionId,
      name,
      clonedCategories: catCreates.length,
      clonedOrderEntries: newOrderIds.length,
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}

// ─── Save: Tracks → Songs → Categories → OrderEntries → Session, so temp ids resolve in turn ──

interface SaveOrderEntry {
  id?: string;
  type: string;
  categoryId?: string;
  start?: number | null;
  end?: number | null;
}
interface SaveCategory {
  id?: string;
  name: string;
  mode: string;
  notice: string;
  illustration: string;
  trackType: string;
  liveOnly: boolean;
  songIds: string[];
}
interface SaveSong {
  id?: string;
  label: string;
  status: string;
  answer: string;
  liveOnly: boolean;
  effects?: Record<string, number>;
  trackIds: string[];
}
interface SaveTrack {
  id?: string;
  artist: string;
  title: string;
  type: string;
  start: number;
  end: number;
  youtubeId: string;
  audioRowId?: number;
}
interface SaveRequest {
  name: string;
  guestPassword: string;
  order: SaveOrderEntry[];
  categories: SaveCategory[];
  songs: SaveSong[];
  tracks: SaveTrack[];
}

// Aligned with grist/schema.ts; a save sends 0 for an absent effect so an old value clears.
const EFFECT_COLUMNS = [
  "speed",
  "pitch",
  "pitchvar",
  "chorus",
  "lowpass",
  "highpass",
  "bitreduction",
  "overdrive",
  "phaser",
];

/** Wire-side string id (numeric or tempId) → real Grist row id. */
function resolveId(
  raw: string | undefined,
  tempMap: Map<string, number>,
): number {
  if (!raw) throw new Error("missing id");
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  const real = tempMap.get(raw);
  if (real !== undefined) return real;
  throw new Error(`unknown temp id "${raw}"`);
}

function resolveAll(refs: string[], tempMap: Map<string, number>): number[] {
  return refs.map((r) => resolveId(r, tempMap));
}

const isRealId = (raw: string | undefined): number => {
  const n = Number(raw ?? "");
  return Number.isInteger(n) && n > 0 ? n : 0;
};

function trackFieldsForSave(t: SaveTrack): GristFields {
  return {
    artist: t.artist,
    title: t.title,
    type: t.type,
    start: t.start,
    end: t.end,
    youtubeId: t.youtubeId,
    // Empty Attachments cell — the wire format is the bare ["L"] sentinel.
    audio: t.audioRowId && t.audioRowId > 0 ? gristIdList(t.audioRowId) : ["L"],
  };
}

function songFieldsForSave(s: SaveSong, trackIds: number[]): GristFields {
  const fields: GristFields = {
    label: s.label,
    status: s.status,
    answer: s.answer,
    liveOnly: s.liveOnly,
    tracks: gristIdList(...trackIds),
  };
  for (const name of EFFECT_COLUMNS)
    fields[`fx_${name}`] = s.effects?.[name] ?? 0;
  return fields;
}

// One Grist call per batch: create the new rows, recording tempId → real id, then update the rest.
async function upsertPhase<T>(
  g: GristClient,
  table: string,
  items: T[],
  idOf: (item: T) => string | undefined,
  fieldsOf: (item: T) => GristFields,
  tempMap: Map<string, number>,
): Promise<void> {
  const creates: GristFields[] = [];
  const createTempIds: string[] = [];
  const updates = new Map<number, GristFields>();
  for (const item of items) {
    const fields = fieldsOf(item);
    const realId = isRealId(idOf(item));
    if (realId > 0) {
      updates.set(realId, fields);
    } else {
      creates.push(fields);
      createTempIds.push(idOf(item) ?? "");
    }
  }
  if (creates.length > 0) {
    const ids = await g.addRecords(table, creates);
    ids.forEach((id, i) => tempMap.set(createTempIds[i], id));
  }
  if (updates.size > 0) await g.updateRecords(table, updates);
}

// POST /editor/sessions/:id — the reconciler; its idMap lets a client patch ids without reloading.
export async function handleEditorSaveSession(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const sessionId = idParam(req, res);
  if (sessionId === 0) return;
  const body = req.body as SaveRequest | undefined;
  if (!body || !Array.isArray(body.order)) {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  let prevOrderIds: number[];
  try {
    const sessionById = await indexRows(g, "Sessions");
    const prev = sessionById.get(sessionId);
    if (!prev) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    prevOrderIds = parseRefList(prev.fields.order);
  } catch (err) {
    res.status(502).json({ error: `read session: ${err}` });
    return;
  }

  const tempMap = new Map<string, number>();
  try {
    // Phases 1–3: Tracks → Songs → Categories.
    await upsertPhase(
      g,
      "Tracks",
      body.tracks ?? [],
      (t) => t.id,
      trackFieldsForSave,
      tempMap,
    );
    await upsertPhase(
      g,
      "Songs",
      body.songs ?? [],
      (s) => s.id,
      (s) => songFieldsForSave(s, resolveAll(s.trackIds ?? [], tempMap)),
      tempMap,
    );
    await upsertPhase(
      g,
      "Categories",
      body.categories ?? [],
      (c) => c.id,
      (c) => ({
        name: c.name,
        mode: c.mode,
        notice: c.notice,
        illustration: c.illustration,
        trackType: c.trackType,
        liveOnly: c.liveOnly,
        songs: gristIdList(...resolveAll(c.songIds ?? [], tempMap)),
      }),
      tempMap,
    );

    // Phase 4: OrderEntries — resolved ids keep the frontend's ordering.
    const orderCreates: GristFields[] = [];
    const createTempIds: string[] = [];
    const createPositions: number[] = [];
    const orderUpdates = new Map<number, GristFields>();
    const orderIds: number[] = new Array(body.order.length).fill(0);
    body.order.forEach((o, i) => {
      let catId = 0;
      if (o.type !== "pause" && o.categoryId)
        catId = resolveId(o.categoryId, tempMap);
      const fields: GristFields = { type: o.type };
      if (o.type !== "pause" && catId > 0) fields.category = catId;
      if (o.start !== undefined && o.start !== null) fields.start = o.start;
      if (o.end !== undefined && o.end !== null) fields.end = o.end;
      const realId = isRealId(o.id);
      if (realId > 0) {
        orderUpdates.set(realId, fields);
        orderIds[i] = realId;
      } else {
        orderCreates.push(fields);
        createTempIds.push(o.id ?? "");
        createPositions.push(i);
      }
    });
    if (orderCreates.length > 0) {
      const ids = await g.addRecords("OrderEntries", orderCreates);
      ids.forEach((id, k) => {
        tempMap.set(createTempIds[k], id);
        orderIds[createPositions[k]] = id;
      });
    }
    if (orderUpdates.size > 0)
      await g.updateRecords("OrderEntries", orderUpdates);

    // Phase 5: the Session row.
    await g.updateRecords(
      "Sessions",
      new Map([
        [
          sessionId,
          {
            name: body.name,
            guestPassword: body.guestPassword,
            order: gristIdList(...orderIds),
          },
        ],
      ]),
    );

    // Phase 6: delete OrderEntries that fell off.
    const newSet = new Set(orderIds);
    const stale = prevOrderIds.filter((id) => !newSet.has(id));
    if (stale.length > 0) {
      try {
        await g.deleteRecords("OrderEntries", stale);
      } catch (err) {
        // Non-fatal: orphan rows, but the session is consistent, and idMap still ships.
        res.json({
          ok: true,
          warning: `delete stale order entries: ${err}`,
          orphanedOrders: stale,
          idMap: Object.fromEntries(tempMap),
        });
        return;
      }
    }
    res.json({
      ok: true,
      sessionId,
      orphanCount: stale.length,
      createdCount: tempMap.size,
      idMap: Object.fromEntries(tempMap),
    });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}
