import type { GristClient } from "./client.ts";

// Session → Order → Categories → Songs → Tracks, owned by RefLists; declared leaves-first.

interface GristTableDef {
  id: string;
  columns: { id: string; type: string }[];
}

export const schemaTables: GristTableDef[] = [
  {
    id: "Tracks",
    columns: [
      { id: "artist", type: "Text" },
      { id: "title", type: "Text" },
      { id: "audio", type: "Attachments" },
      // Variant marker ("" is the original); a category's trackType picks its match at play time.
      { id: "type", type: "Text" },
      // start/end, not from/to: "from" is a Python keyword and Grist silently renames those.
      { id: "start", type: "Numeric" },
      { id: "end", type: "Numeric" },
      { id: "youtubeId", type: "Text" },
    ],
  },
  {
    id: "Songs",
    columns: [
      { id: "label", type: "Text" },
      { id: "status", type: "Text" },
      { id: "answer", type: "Text" },
      { id: "liveOnly", type: "Bool" },
      { id: "fx_speed", type: "Int" },
      { id: "fx_pitch", type: "Int" },
      { id: "fx_pitchvar", type: "Int" },
      { id: "fx_chorus", type: "Int" },
      { id: "fx_lowpass", type: "Int" },
      { id: "fx_highpass", type: "Int" },
      { id: "fx_bitreduction", type: "Int" },
      { id: "fx_overdrive", type: "Int" },
      { id: "fx_phaser", type: "Int" },
      { id: "tracks", type: "RefList:Tracks" },
    ],
  },
  {
    id: "Categories",
    columns: [
      { id: "name", type: "Text" },
      { id: "notice", type: "Text" },
      { id: "illustration", type: "Text" },
      { id: "mode", type: "Text" },
      { id: "trackType", type: "Text" },
      { id: "liveOnly", type: "Bool" },
      { id: "songs", type: "RefList:Songs" },
    ],
  },
  {
    id: "OrderEntries",
    columns: [
      { id: "type", type: "Text" }, // "cat" or "pause"
      { id: "category", type: "Ref:Categories" },
      { id: "start", type: "Int" },
      { id: "end", type: "Int" },
    ],
  },
  {
    id: "Sessions",
    columns: [
      { id: "name", type: "Text" },
      { id: "guestPassword", type: "Text" },
      { id: "urlToken", type: "Text" },
      { id: "order", type: "RefList:OrderEntries" },
    ],
  },
  {
    id: "Scores",
    columns: [
      { id: "user", type: "Text" },
      { id: "session", type: "Ref:Sessions" },
      { id: "value", type: "Numeric" },
      { id: "userName", type: "Text" },
    ],
  },
  {
    id: "Games",
    columns: [
      { id: "gameId", type: "Text" },
      { id: "createdAt", type: "DateTime" },
      { id: "updatedAt", type: "DateTime" },
      { id: "session", type: "Ref:Sessions" },
      { id: "phase", type: "Text" },
      { id: "orderIndex", type: "Int" },
      { id: "songIndex", type: "Int" },
      { id: "started", type: "Bool" },
      { id: "finished", type: "Bool" },
    ],
  },
  {
    id: "GamePlayers",
    columns: [
      { id: "game", type: "Ref:Games" },
      { id: "name", type: "Text" },
      { id: "deviceId", type: "Text" },
      { id: "score", type: "Numeric" },
    ],
  },
  {
    id: "Buzzers",
    columns: [
      { id: "token", type: "Text" },
      { id: "deviceId", type: "Text" },
      { id: "createdAt", type: "DateTime" },
    ],
  },
  {
    id: "Counters",
    columns: [
      { id: "name", type: "Text" },
      { id: "value", type: "Int" },
    ],
  },
  {
    id: "Guests",
    columns: [
      { id: "subject", type: "Text" },
      { id: "username", type: "Text" },
      { id: "createdAt", type: "DateTime" },
    ],
  },
  // A saved playlist LINK, deduplicated on (provider, playlistId); no track or audio data.
  {
    id: "Playlists",
    columns: [
      { id: "provider", type: "Text" },
      { id: "playlistId", type: "Text" },
      { id: "url", type: "Text" },
      { id: "name", type: "Text" },
      { id: "cover", type: "Text" },
      { id: "trackCount", type: "Int" },
      { id: "addedBy", type: "Text" },
      { id: "addedAt", type: "DateTime" },
    ],
  },
  {
    id: "PlaylistScores",
    columns: [
      { id: "user", type: "Text" },
      { id: "playlist", type: "Ref:Playlists" },
      { id: "value", type: "Numeric" },
      { id: "userName", type: "Text" },
    ],
  },
  {
    id: "SoloProgress",
    columns: [
      { id: "user", type: "Text" },
      { id: "session", type: "Ref:Sessions" },
      { id: "orderIndex", type: "Int" },
      { id: "songIndex", type: "Int" },
      { id: "played", type: "Int" },
      { id: "total", type: "Int" },
      { id: "score", type: "Numeric" },
      { id: "updatedAt", type: "DateTime" },
    ],
  },
];

/** Add what is missing, on every boot; a type CHANGE is never applied, since it would lose data. */
export async function ensureGristSchema(g: GristClient): Promise<void> {
  const existing = await g.listTables();
  const have = new Map<string, string>(); // lower-case id → actual stored id
  for (const id of existing) have.set(id.toLowerCase(), id);
  console.log(
    `[Grist] Schema bootstrap: ${existing.length} existing tables: ${existing.join(", ")}`,
  );

  let created = 0;
  let addedColumns = 0;
  for (const t of schemaTables) {
    let actualId = have.get(t.id.toLowerCase());
    if (!actualId) {
      const cols = t.columns.map((c) => ({ id: c.id, type: c.type }));
      try {
        await g.apply([["AddTable", t.id, cols]]);
        console.log(
          `[Grist] Created table ${t.id} (${t.columns.length} columns)`,
        );
        created++;
        continue;
      } catch (err) {
        // Most likely the table exists and ListTables missed it, so reconcile its columns anyway.
        console.log(
          `[Grist] AddTable ${t.id} failed (${err}) — falling through to column reconciliation`,
        );
        actualId = t.id;
      }
    } else if (actualId !== t.id) {
      console.log(
        `[Grist] Table "${actualId}" matches schema "${t.id}" (case differs) — using "${actualId}"`,
      );
    }

    let liveCols: string[];
    try {
      liveCols = await g.listColumns(actualId);
    } catch (err) {
      console.log(`[Grist] ListColumns ${actualId} skipped: ${err}`);
      continue;
    }
    const live = new Set(liveCols.map((c) => c.toLowerCase()));
    const missing = t.columns.filter((c) => !live.has(c.id.toLowerCase()));
    console.log(
      `[Grist] ${actualId} columns: live=[${liveCols.join(",")}] schema=[${t.columns.map((c) => c.id).join(",")}] missing=[${missing.map((c) => c.id).join(",")}]`,
    );
    for (const c of missing) {
      // AddVisibleColumn, not AddColumn: it also attaches the column to the raw view section.
      try {
        await g.apply([
          [
            "AddVisibleColumn",
            actualId,
            c.id,
            { type: c.type, isFormula: false },
          ],
        ]);
        console.log(`[Grist] Added column ${actualId}.${c.id} (${c.type})`);
        addedColumns++;
      } catch (err) {
        console.log(
          `[Grist] AddVisibleColumn ${actualId}.${c.id} (${c.type}) FAILED: ${err}`,
        );
      }
    }
  }
  if (created === 0 && addedColumns === 0) {
    console.log(
      `[Grist] Schema OK — all ${schemaTables.length} declared tables present`,
    );
  } else if (created === 0) {
    console.log(
      `[Grist] Schema OK — added ${addedColumns} column(s) to existing tables`,
    );
  }
}
